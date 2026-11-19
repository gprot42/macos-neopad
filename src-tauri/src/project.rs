//! Folder ("project") support: listing a directory for the file tree, the
//! flat file list behind Go to File, and search across files.
//!
//! The recursive walks honour `.gitignore` (and friends) via the `ignore`
//! crate, so `node_modules`, `target` and the like stay out of Go to File and
//! search results. The file tree itself shows everything except `.git`.

use std::fs;
use std::io::Read;
use std::path::Path;

use ignore::WalkBuilder;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

/// Go to File stops collecting paths here.
const MAX_LISTED_FILES: usize = 50_000;
/// Search stops after this many matching lines…
const MAX_MATCHES: usize = 2_000;
/// …and reports at most this many per file.
const MAX_MATCHES_PER_FILE: usize = 200;
/// Files larger than this are not searched.
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Matched lines are cut to roughly this many characters around the match.
const PREVIEW_CHARS: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    /// Paths relative to the root, `/`-separated.
    files: Vec<String>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    line: usize,
    /// 1-based UTF-16 columns of the match in the full line, as Monaco counts.
    start_column: usize,
    end_column: usize,
    preview: String,
    /// Character range of the match inside `preview`.
    preview_start: usize,
    preview_end: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    path: String,
    rel: String,
    matches: Vec<SearchMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    files: Vec<FileMatches>,
    match_count: usize,
    truncated: bool,
}

fn walker(root: &Path) -> ignore::Walk {
    WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(|e| e.file_name() != ".git")
        .sort_by_file_path(|a, b| a.cmp(b))
        .build()
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// Open a folder as the project: checks it is a directory and lets the fs
/// plugin write inside it. Returns the canonical path.
#[tauri::command]
pub fn project_open(app: AppHandle, path: String) -> Result<String, String> {
    let root = fs::canonicalize(&path).map_err(|e| format!("Cannot open {path}: {e}"))?;
    if !root.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    let _ = app.fs_scope().allow_directory(&root, true);
    Ok(root.to_string_lossy().into_owned())
}

/// The entries of one directory, folders first, for the file tree.
#[tauri::command]
pub async fn project_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(|e| format!("Cannot read {path}: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git" || name == ".DS_Store" {
                return None;
            }
            // Follow symlinks so a linked folder can be expanded.
            let is_dir = fs::metadata(entry.path()).map(|m| m.is_dir()).unwrap_or(false);
            Some(DirEntry {
                name,
                path: entry.path().to_string_lossy().into_owned(),
                is_dir,
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Every file under `root` that is not ignored, for Go to File.
#[tauri::command]
pub async fn project_list_files(root: String) -> Result<FileList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&root);
        let mut files = Vec::new();
        let mut truncated = false;
        for entry in walker(root).flatten() {
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            if files.len() >= MAX_LISTED_FILES {
                truncated = true;
                break;
            }
            files.push(rel_path(root, entry.path()));
        }
        FileList { files, truncated }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Text of a file if it is worth searching: not too big, not binary, UTF-8.
fn searchable_text(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_SEARCH_FILE_BYTES {
        return None;
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    fs::File::open(path).ok()?.read_to_end(&mut bytes).ok()?;
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn line_match(line: &str, number: usize, start: usize, end: usize) -> SearchMatch {
    // Keep the preview short for long (minified) lines, centred on the match.
    let before: Vec<char> = line[..start].chars().collect();
    let matched: Vec<char> = line[start..end].chars().collect();
    let lead = before.len().min(PREVIEW_CHARS / 4);
    let skipped = before.len() - lead;
    // Leading indentation is noise in a result list.
    let trim = if skipped == 0 {
        before.iter().take_while(|c| c.is_whitespace()).count()
    } else {
        0
    };
    let mut preview: String = String::new();
    if skipped > 0 {
        preview.push('…');
    }
    preview.extend(&before[skipped + trim..]);
    let preview_start = preview.chars().count();
    preview.extend(matched.iter().take(PREVIEW_CHARS));
    let preview_end = preview.chars().count();
    let room = PREVIEW_CHARS.saturating_sub(preview_end);
    let mut rest = line[end..].chars();
    preview.extend(rest.by_ref().take(room));
    if rest.next().is_some() {
        preview.push('…');
    }

    SearchMatch {
        line: number,
        start_column: utf16_len(&line[..start]) + 1,
        end_column: utf16_len(&line[..end]) + 1,
        preview,
        preview_start,
        preview_end,
    }
}

/// Search the files under `root` line by line. `query` is literal text unless
/// `regex` is set.
#[tauri::command]
pub async fn project_search(
    root: String,
    query: String,
    case_sensitive: bool,
    regex: bool,
) -> Result<SearchResults, String> {
    let pattern = if regex { query.clone() } else { regex::escape(&query) };
    let re = regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid regular expression: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&root);
        let mut files = Vec::new();
        let mut match_count = 0;
        let mut truncated = false;

        'walk: for entry in walker(root).flatten() {
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            let Some(text) = searchable_text(entry.path()) else {
                continue;
            };
            let mut matches = Vec::new();
            for (idx, line) in text.lines().enumerate() {
                // One result per line: the first non-empty match.
                let Some(m) = re.find_iter(line).find(|m| !m.is_empty()) else {
                    continue;
                };
                matches.push(line_match(line, idx + 1, m.start(), m.end()));
                match_count += 1;
                if match_count >= MAX_MATCHES {
                    truncated = true;
                    break;
                }
                if matches.len() >= MAX_MATCHES_PER_FILE {
                    break;
                }
            }
            if !matches.is_empty() {
                files.push(FileMatches {
                    path: entry.path().to_string_lossy().into_owned(),
                    rel: rel_path(root, entry.path()),
                    matches,
                });
            }
            if truncated {
                break 'walk;
            }
        }
        SearchResults { files, match_count, truncated }
    })
    .await
    .map_err(|e| e.to_string())
}
