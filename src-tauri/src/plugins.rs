//! Plugin storage.
//!
//! Plugins are VS Code extensions unpacked under
//! `~/Library/Application Support/com.neopad.editor/plugins/<publisher>.<name>-<version>/`,
//! exactly as VS Code lays them out. NeoPad only ever *reads data* from them
//! (themes, grammars, snippets, language settings); it never runs their code.
//!
//! Everything here treats plugin contents as untrusted input: reads are
//! confined to the plugin's own folder (including through symlinks), and
//! `.vsix` extraction rejects path traversal and caps total size.

use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const MANIFEST: &str = "package.json";
const SEED_MARKER: &str = ".seeded.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_READ_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;
const MAX_VSIX_ENTRIES: usize = 20_000;
const MAX_VSIX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_VSIX_DOWNLOAD_BYTES: &str = "268435456"; // 256 MiB, passed to curl

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    /// Folder name under the plugins root; the handle the frontend uses.
    pub dir_name: String,
    /// Absolute path, for display only.
    pub path: String,
    /// Raw `package.json` text; the frontend parses it.
    pub manifest: String,
}

fn plugins_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data directory: {e}"))?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Publisher, extension names and versions end up in folder names and URLs.
fn is_safe_token(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !s.contains("..")
}

/// A plugin folder name: a single, non-hidden path component.
fn plugin_dir(root: &Path, dir_name: &str) -> Result<PathBuf, String> {
    if !is_safe_token(dir_name) {
        return Err(format!("Invalid plugin folder name: {dir_name}"));
    }
    let dir = root.join(dir_name);
    if !dir.is_dir() {
        return Err(format!("Plugin not found: {dir_name}"));
    }
    Ok(dir)
}

/// A relative path inside a plugin. Rejects anything that is absolute or walks
/// upwards, then re-checks after resolving symlinks.
fn resolve_in_plugin(plugin: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim_start_matches("./");
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || !rel_path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(format!("Path escapes the plugin folder: {rel}"));
    }
    let base = plugin
        .canonicalize()
        .map_err(|e| format!("Cannot resolve plugin folder: {e}"))?;
    let full = base
        .join(rel_path)
        .canonicalize()
        .map_err(|e| format!("Cannot read {rel}: {e}"))?;
    if !full.starts_with(&base) {
        return Err(format!("Path escapes the plugin folder: {rel}"));
    }
    Ok(full)
}

fn read_capped(path: &Path, cap: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let mut buf = Vec::new();
    file.take(cap + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    if buf.len() as u64 > cap {
        return Err(format!("{} is too large", path.display()));
    }
    Ok(buf)
}

fn read_manifest(dir: &Path) -> Option<String> {
    let bytes = read_capped(&dir.join(MANIFEST), MAX_MANIFEST_BYTES).ok()?;
    String::from_utf8(bytes).ok()
}

fn list_in(root: &Path) -> Result<Vec<InstalledPlugin>, String> {
    let mut out = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("Cannot list plugins: {e}"))?;
    for entry in entries.flatten() {
        let dir_name = entry.file_name().to_string_lossy().into_owned();
        // Skips hidden folders, including half-finished `.installing-*` ones.
        if !is_safe_token(&dir_name) || !entry.path().is_dir() {
            continue;
        }
        if let Some(manifest) = read_manifest(&entry.path()) {
            out.push(InstalledPlugin {
                path: entry.path().to_string_lossy().into_owned(),
                dir_name,
                manifest,
            });
        }
    }
    out.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    Ok(out)
}

/// `publisher.name`, lower-cased — VS Code's extension identifier.
fn manifest_id(manifest: &str) -> Option<(String, String, String)> {
    let v: serde_json::Value = serde_json::from_str(manifest).ok()?;
    let publisher = v.get("publisher")?.as_str()?.to_string();
    let name = v.get("name")?.as_str()?.to_string();
    let version = v.get("version")?.as_str()?.to_string();
    Some((publisher, name, version))
}

/// Unpacks a `.vsix` (a zip whose payload lives under `extension/`) into the
/// plugins root, replacing any installed version of the same extension.
fn install_vsix<R: Read + Seek>(root: &Path, reader: R) -> Result<InstalledPlugin, String> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("Not a valid .vsix file: {e}"))?;
    if zip.len() > MAX_VSIX_ENTRIES {
        return Err("The .vsix file contains too many files".into());
    }

    let manifest = {
        let entry = zip
            .by_name("extension/package.json")
            .map_err(|_| "Not a VS Code extension: extension/package.json is missing".to_string())?;
        let mut text = String::new();
        entry
            .take(MAX_MANIFEST_BYTES)
            .read_to_string(&mut text)
            .map_err(|e| format!("Cannot read package.json: {e}"))?;
        text
    };
    let (publisher, name, version) = manifest_id(&manifest)
        .ok_or("package.json needs string \"publisher\", \"name\" and \"version\" fields")?;
    if ![&publisher, &name, &version].iter().all(|s| is_safe_token(s)) {
        return Err(format!("Unsupported extension identifier: {publisher}.{name}@{version}"));
    }
    let id = format!("{publisher}.{name}").to_lowercase();
    let dir_name = format!("{id}-{version}");

    // Extract into a hidden staging folder first, so a failure halfway through
    // never leaves a broken plugin behind (list_in skips hidden folders).
    let staging = root.join(format!(".installing-{dir_name}"));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("Cannot create staging folder: {e}"))?;
    let result = (|| -> Result<(), String> {
        let mut budget = MAX_VSIX_UNPACKED_BYTES;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| format!("Corrupt .vsix: {e}"))?;
            if entry.is_dir() || entry.is_symlink() {
                continue;
            }
            // enclosed_name() rejects absolute paths and `..` traversal.
            let Some(path) = entry.enclosed_name() else { continue };
            let Ok(rel) = path.strip_prefix("extension") else { continue };
            if rel.as_os_str().is_empty() {
                continue;
            }
            let dest = staging.join(rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Cannot create folder: {e}"))?;
            }
            let mut out = fs::File::create(&dest).map_err(|e| format!("Cannot write file: {e}"))?;
            let written = std::io::copy(&mut (&mut entry).take(budget + 1), &mut out)
                .map_err(|e| format!("Cannot unpack {}: {e}", rel.display()))?;
            if written > budget {
                return Err("The .vsix file unpacks to more than 512 MB".into());
            }
            budget -= written;
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }

    // Replace every installed version of this extension.
    for existing in list_in(root)? {
        if let Some((p, n, _)) = manifest_id(&existing.manifest) {
            if format!("{p}.{n}").to_lowercase() == id {
                let _ = fs::remove_dir_all(root.join(&existing.dir_name));
            }
        }
    }
    let final_dir = root.join(&dir_name);
    let _ = fs::remove_dir_all(&final_dir);
    fs::rename(&staging, &final_dir).map_err(|e| format!("Cannot finish install: {e}"))?;

    Ok(InstalledPlugin {
        path: final_dir.to_string_lossy().into_owned(),
        dir_name,
        manifest,
    })
}

fn curl_https(url: &str, out: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/curl")
        .args(["--fail", "--silent", "--show-error", "--location"])
        .args(["--proto", "=https", "--proto-redir", "=https"])
        .args(["--max-time", "180", "--max-filesize", MAX_VSIX_DOWNLOAD_BYTES])
        .arg("--output")
        .arg(out)
        .arg(url)
        .output()
        .map_err(|e| format!("Cannot run curl: {e}"))?;
    if !status.status.success() {
        return Err(format!(
            "Download failed: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        ));
    }
    Ok(())
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn plugins_list(app: AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    list_in(&plugins_root(&app)?)
}

#[tauri::command]
pub fn plugins_read_text(app: AppHandle, dir_name: String, path: String) -> Result<String, String> {
    let file = resolve_in_plugin(&plugin_dir(&plugins_root(&app)?, &dir_name)?, &path)?;
    String::from_utf8(read_capped(&file, MAX_READ_BYTES)?)
        .map_err(|_| format!("{path} is not UTF-8 text"))
}

#[tauri::command]
pub fn plugins_read_base64(app: AppHandle, dir_name: String, path: String) -> Result<String, String> {
    let file = resolve_in_plugin(&plugin_dir(&plugins_root(&app)?, &dir_name)?, &path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(read_capped(&file, MAX_ICON_BYTES)?))
}

#[tauri::command]
pub fn plugins_install_vsix(app: AppHandle, path: String) -> Result<InstalledPlugin, String> {
    let file = fs::File::open(&path).map_err(|e| format!("Cannot open {path}: {e}"))?;
    install_vsix(&plugins_root(&app)?, file)
}

/// Downloads `namespace.name@version` from Open VSX and installs it. The URL is
/// built here from validated parts rather than accepted from the webview.
#[tauri::command]
pub async fn plugins_install_openvsx(
    app: AppHandle,
    namespace: String,
    name: String,
    version: String,
) -> Result<InstalledPlugin, String> {
    if ![&namespace, &name, &version].iter().all(|s| is_safe_token(s)) {
        return Err("Invalid extension identifier".into());
    }
    let root = plugins_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let base = format!("https://open-vsx.org/api/{namespace}/{name}/{version}/file/{namespace}.{name}-{version}");
        let tmp = std::env::temp_dir().join(format!(
            "neopad-{namespace}.{name}-{version}-{}.vsix",
            std::process::id()
        ));
        let sha_tmp = tmp.with_extension("sha256");
        let result = (|| {
            curl_https(&format!("{base}.vsix"), &tmp)?;
            // Verify against the published checksum when Open VSX has one.
            if curl_https(&format!("{base}.sha256"), &sha_tmp).is_ok() {
                let expected = fs::read_to_string(&sha_tmp).unwrap_or_default();
                let expected = expected.split_whitespace().next().unwrap_or("").to_lowercase();
                let actual = format!("{:x}", Sha256::digest(read_capped(&tmp, u64::MAX)?));
                if !expected.is_empty() && expected != actual {
                    return Err("Checksum mismatch: the download is corrupt or was tampered with".to_string());
                }
            }
            install_vsix(&root, fs::File::open(&tmp).map_err(|e| e.to_string())?)
        })();
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&sha_tmp);
        result
    })
    .await
    .map_err(|e| format!("Install task failed: {e}"))?
}

#[tauri::command]
pub fn plugins_uninstall(app: AppHandle, dir_name: String) -> Result<(), String> {
    let dir = plugin_dir(&plugins_root(&app)?, &dir_name)?;
    fs::remove_dir_all(&dir).map_err(|e| format!("Cannot remove {dir_name}: {e}"))
}

/// Opens the plugins folder (or one plugin's folder) in Finder.
#[tauri::command]
pub fn plugins_reveal(app: AppHandle, dir_name: Option<String>) -> Result<(), String> {
    let root = plugins_root(&app)?;
    let target = match dir_name {
        Some(d) => plugin_dir(&root, &d)?,
        None => root,
    };
    Command::new("/usr/bin/open")
        .arg(target)
        .spawn()
        .map_err(|e| format!("Cannot open Finder: {e}"))?;
    Ok(())
}

/// Installs a plugin that ships with NeoPad — but only the first time, so a
/// user who uninstalls it doesn't get it back on every launch. Returns whether
/// anything was written.
#[tauri::command]
pub fn plugins_seed(
    app: AppHandle,
    plugin_id: String,
    dir_name: String,
    files: Vec<(String, String)>,
) -> Result<bool, String> {
    seed_in(&plugins_root(&app)?, &plugin_id, &dir_name, &files)
}

fn seed_in(root: &Path, plugin_id: &str, dir_name: &str, files: &[(String, String)]) -> Result<bool, String> {
    if !is_safe_token(dir_name) {
        return Err(format!("Invalid plugin folder name: {dir_name}"));
    }
    let marker = root.join(SEED_MARKER);
    let mut seeded: BTreeSet<String> = fs::read_to_string(&marker)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if seeded.contains(plugin_id) {
        return Ok(false);
    }
    let dir = root.join(dir_name);
    let wrote = !dir.exists();
    if wrote {
        for (rel, content) in files {
            let rel_path = Path::new(rel);
            if !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
                return Err(format!("Invalid seed path: {rel}"));
            }
            let dest = dir.join(rel_path);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::File::create(&dest)
                .and_then(|mut f| f.write_all(content.as_bytes()))
                .map_err(|e| format!("Cannot write {rel}: {e}"))?;
        }
    }
    seeded.insert(plugin_id.to_string());
    fs::write(&marker, serde_json::to_string_pretty(&seeded).unwrap_or_default())
        .map_err(|e| format!("Cannot write seed marker: {e}"))?;
    Ok(wrote)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("neopad-plugins-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn vsix(entries: &[(&str, &str)]) -> Cursor<Vec<u8>> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in entries {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        Cursor::new(w.finish().unwrap().into_inner())
    }

    const MANIFEST_V1: &str = r#"{"publisher":"Acme","name":"night","version":"1.0.0"}"#;
    const MANIFEST_V2: &str = r#"{"publisher":"Acme","name":"night","version":"2.0.0"}"#;

    #[test]
    fn installs_extension_payload_only() {
        let root = temp_root("payload");
        let p = install_vsix(&root, vsix(&[
            ("extension.vsixmanifest", "<xml/>"),
            ("extension/package.json", MANIFEST_V1),
            ("extension/themes/night.json", "{}"),
        ]))
        .unwrap();
        assert_eq!(p.dir_name, "acme.night-1.0.0");
        assert!(root.join("acme.night-1.0.0/themes/night.json").is_file());
        assert!(!root.join("acme.night-1.0.0/extension.vsixmanifest").exists());
        assert_eq!(list_in(&root).unwrap().len(), 1);
    }

    #[test]
    fn rejects_traversal_and_absolute_entries() {
        let root = temp_root("traversal");
        install_vsix(&root, vsix(&[
            ("extension/package.json", MANIFEST_V1),
            ("extension/../../escaped.txt", "x"),
            ("/tmp/neopad-absolute-escape.txt", "x"),
        ]))
        .unwrap();
        assert!(!root.parent().unwrap().join("escaped.txt").exists());
        assert!(!Path::new("/tmp/neopad-absolute-escape.txt").exists());
    }

    #[test]
    fn new_version_replaces_old() {
        let root = temp_root("replace");
        install_vsix(&root, vsix(&[("extension/package.json", MANIFEST_V1)])).unwrap();
        install_vsix(&root, vsix(&[("extension/package.json", MANIFEST_V2)])).unwrap();
        let names: Vec<_> = list_in(&root).unwrap().into_iter().map(|p| p.dir_name).collect();
        assert_eq!(names, vec!["acme.night-2.0.0"]);
    }

    #[test]
    fn rejects_non_extensions_and_hostile_ids() {
        let root = temp_root("ids");
        assert!(install_vsix(&root, vsix(&[("readme.md", "hi")])).is_err());
        let hostile = r#"{"publisher":"..","name":"x/y","version":"1"}"#;
        assert!(install_vsix(&root, vsix(&[("extension/package.json", hostile)])).is_err());
        assert!(list_in(&root).unwrap().is_empty());
    }

    #[test]
    fn reads_are_confined_to_the_plugin() {
        let root = temp_root("confine");
        install_vsix(&root, vsix(&[
            ("extension/package.json", MANIFEST_V1),
            ("extension/a.json", "{}"),
        ]))
        .unwrap();
        let plugin = plugin_dir(&root, "acme.night-1.0.0").unwrap();
        assert!(resolve_in_plugin(&plugin, "./a.json").is_ok());
        assert!(resolve_in_plugin(&plugin, "../acme.night-1.0.0/a.json").is_err());
        assert!(resolve_in_plugin(&plugin, "/etc/hosts").is_err());
        std::os::unix::fs::symlink("/etc/hosts", plugin.join("link")).unwrap();
        assert!(resolve_in_plugin(&plugin, "link").is_err());
        assert!(plugin_dir(&root, "../x").is_err());
        assert!(plugin_dir(&root, ".seeded.json").is_err());
    }

    #[test]
    fn seeds_only_once() {
        let root = temp_root("seed");
        let files = vec![("package.json".to_string(), MANIFEST_V1.to_string())];
        assert!(seed_in(&root, "acme.night", "acme.night-1.0.0", &files).unwrap());
        fs::remove_dir_all(root.join("acme.night-1.0.0")).unwrap(); // user uninstalls
        assert!(!seed_in(&root, "acme.night", "acme.night-1.0.0", &files).unwrap());
        assert!(!root.join("acme.night-1.0.0").exists());
        let bad = vec![("../evil".to_string(), String::new())];
        assert!(seed_in(&root, "acme.other", "acme.other-1", &bad).is_err());
    }
}
