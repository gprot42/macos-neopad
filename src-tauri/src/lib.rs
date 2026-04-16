use std::process::Command;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_fs::FsExt;

struct PendingFiles(Mutex<Vec<String>>);

/// Register the app bundle with macOS Launch Services so file type
/// handlers (.doc, .docx, .txt, .csv, etc.) are available in "Open With".
fn register_with_launch_services() {
    // Get the path to our .app bundle
    let exe = std::env::current_exe().unwrap_or_default();
    // Executable is at <Bundle>/Contents/MacOS/<name>, so .app is 3 levels up
    if let Some(app_bundle) = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
    {
        if app_bundle.extension().map_or(false, |ext| ext == "app") {
            let _ = Command::new("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
                .arg("-f")
                .arg(app_bundle)
                .output();
        }
    }
}

#[tauri::command]
fn get_pending_files(state: tauri::State<PendingFiles>, app: tauri::AppHandle) -> Vec<String> {
    let mut pending = state.0.lock().unwrap();
    let files: Vec<String> = pending.drain(..).collect();
    let fs_scope = app.fs_scope();
    for path in &files {
        let _ = fs_scope.allow_file(path);
    }
    files
}

use base64::Engine;

#[tauri::command]
fn append_log(lines: String) {
    let log_dir = dirs::home_dir()
        .unwrap_or_default()
        .join("Library/Logs/Neo Edit");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("neo-edit.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true).append(true).open(&log_path)
    {
        let _ = f.write_all(lines.as_bytes());
    }
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // Second instance detected — handled by deep-link plugin instead
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            get_pending_files,
            read_file_bytes,
            read_file_text,
            append_log
        ])
        .setup(|app| {
            // Register file type handlers with macOS on every launch
            register_with_launch_services();

            // Handle files opened via macOS "Open With" / file associations
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                eprintln!("[Neo Edit] on_open_url fired: {:?}", urls);
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| {
                        if url.scheme() == "file" {
                            let p = url.to_file_path()
                                .ok()
                                .map(|p| p.to_string_lossy().into_owned());
                            eprintln!("[Neo Edit] resolved path: {:?}", p);
                            p
                        } else {
                            eprintln!("[Neo Edit] skipping non-file URL: {}", url);
                            None
                        }
                    })
                    .collect();

                if paths.is_empty() {
                    return;
                }

                // Add files to FS scope
                let fs_scope = handle.fs_scope();
                for path in &paths {
                    let _ = fs_scope.allow_file(path);
                    eprintln!("[Neo Edit] added to FS scope: {}", path);
                }

                // ALWAYS store as pending first (so get_pending_files can retrieve them)
                if let Some(state) = handle.try_state::<PendingFiles>() {
                    eprintln!("[Neo Edit] storing {} file(s) as pending", paths.len());
                    state.0.lock().unwrap().extend(paths.clone());
                }

                // If window exists, also emit a signal to check pending files
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.set_focus();
                    let handle_clone = handle.clone();
                    std::thread::spawn(move || {
                        // Wait for the webview to be ready
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        eprintln!("[Neo Edit] emitting check-pending-files signal");
                        if let Some(w) = handle_clone.get_webview_window("main") {
                            let _ = w.emit("check-pending-files", ());
                        }
                    });
                }
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle();

            let new_file = MenuItemBuilder::with_id("new_file", "New File")
                .accelerator("CmdOrCtrl+N")
                .build(handle)?;
            let new_tab = MenuItemBuilder::with_id("new_tab", "New Tab")
                .accelerator("CmdOrCtrl+T")
                .build(handle)?;
            let open = MenuItemBuilder::with_id("open_file", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?;
            let save = MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(handle)?;
            let save_as = MenuItemBuilder::with_id("save_as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(handle)?;
            let close_tab = MenuItemBuilder::with_id("close_tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(handle)?;
            let close_all = MenuItemBuilder::with_id("close_all", "Close All")
                .accelerator("CmdOrCtrl+Shift+W")
                .build(handle)?;

            let print = MenuItemBuilder::with_id("print", "Print...")
                .accelerator("CmdOrCtrl+P")
                .build(handle)?;

            let settings = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;

            let find = MenuItemBuilder::with_id("find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(handle)?;
            let replace = MenuItemBuilder::with_id("replace", "Replace...")
                .accelerator("CmdOrCtrl+H")
                .build(handle)?;

            let about = MenuItemBuilder::with_id(
                "about",
                &format!("Neo Edit v{}", env!("CARGO_PKG_VERSION")),
            )
            .build(handle)?;

            let quit = MenuItemBuilder::with_id("quit", "Quit Neo Edit")
                .accelerator("CmdOrCtrl+Q")
                .build(handle)?;

            let toggle_preview = MenuItemBuilder::with_id("toggle_preview", "Toggle Preview")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(handle)?;
            let toggle_outline = MenuItemBuilder::with_id("toggle_outline", "Toggle Outline")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(handle)?;
            let insert_table = MenuItemBuilder::with_id("insert_table", "Insert Table...")
                .accelerator("CmdOrCtrl+Shift+T")
                .build(handle)?;
            let export_html = MenuItemBuilder::with_id("export_html", "Export to HTML...")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(handle)?;
            let export_pdf =
                MenuItemBuilder::with_id("export_pdf", "Export to PDF...").build(handle)?;

            let app_menu = SubmenuBuilder::new(handle, "Neo Edit")
                .item(&about)
                .separator()
                .item(&settings)
                .separator()
                .item(&quit)
                .build()?;

            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&new_file)
                .item(&new_tab)
                .separator()
                .item(&open)
                .separator()
                .item(&save)
                .item(&save_as)
                .separator()
                .item(&close_tab)
                .item(&close_all)
                .separator()
                .item(&print)
                .build()?;

            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&find)
                .item(&replace)
                .build()?;

            let markdown_menu = SubmenuBuilder::new(handle, "Markdown")
                .item(&toggle_preview)
                .item(&toggle_outline)
                .separator()
                .item(&insert_table)
                .separator()
                .item(&export_html)
                .item(&export_pdf)
                .build()?;

            let menu = MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&markdown_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                if id == "quit" {
                    // Force quit — std::process::exit ensures immediate shutdown
                    std::process::exit(0);
                }
                if id == "about" {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let version = env!("CARGO_PKG_VERSION");
                        let _ = window.eval(&format!(
                            "window.__menuAction && window.__menuAction('about', '{}')",
                            version
                        ));
                    }
                    return;
                }
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.eval(&format!(
                        "window.__menuAction && window.__menuAction('{}')",
                        id
                    ));
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // Handle files opened via macOS "Open With" on cold start
                tauri::RunEvent::Opened { urls } => {
                    eprintln!("[Neo Edit] RunEvent::Opened fired: {:?}", urls);
                    let paths: Vec<String> = urls
                        .iter()
                        .filter_map(|url| {
                            if url.scheme() == "file" {
                                url.to_file_path()
                                    .ok()
                                    .map(|p| p.to_string_lossy().into_owned())
                            } else {
                                None
                            }
                        })
                        .collect();

                    if paths.is_empty() {
                        return;
                    }

                    // Add files to FS scope
                    let fs_scope = app_handle.fs_scope();
                    for path in &paths {
                        let _ = fs_scope.allow_file(path);
                        eprintln!("[Neo Edit] Opened: added to FS scope: {}", path);
                    }

                    // Store as pending
                    if let Some(state) = app_handle.try_state::<PendingFiles>() {
                        eprintln!("[Neo Edit] Opened: storing {} file(s) as pending", paths.len());
                        state.0.lock().unwrap().extend(paths);
                    }

                    // Signal the frontend to check pending files
                    if app_handle.get_webview_window("main").is_some() {
                        let handle = app_handle.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.emit("check-pending-files", ());
                            }
                        });
                    }
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { .. },
                    ..
                } => {
                    // Only exit when the main window is closed.
                    // Tauri may create other internal/short-lived windows whose
                    // CloseRequested should not terminate the application.
                    if label == "main" {
                        eprintln!("[Neo Edit] main window CloseRequested — exiting");
                        std::process::exit(0);
                    }
                }
                _ => {}
            }
        });
}
