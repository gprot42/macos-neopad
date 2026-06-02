use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// A live PTY session: the master handle (for resize/write) plus a writer and
/// a running flag shared with the reader thread so it can stop emitting after kill.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    running: Arc<AtomicBool>,
}

/// Managed Tauri state holding the (optional) active PTY session.
pub struct PtyState(pub Mutex<Option<PtySession>>);

impl Default for PtyState {
    fn default() -> Self {
        PtyState(Mutex::new(None))
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // If a session already exists, leave it as-is (idempotent).
    if guard.is_some() {
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new("/bin/bash");
    cmd.arg("-l");
    // Inherit the parent environment so bash has PATH, HOME, USER, etc.
    // (portable-pty's CommandBuilder starts with an empty environment.)
    for (key, val) in std::env::vars() {
        cmd.env(key, val);
    }
    let dir = cwd
        .filter(|d| !d.is_empty())
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().into_owned()));
    if let Some(d) = dir {
        cmd.cwd(d);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn bash failed: {e}"))?;
    // Slave is held by the child; drop our reference so EOF propagates on exit.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    let running = Arc::new(AtomicBool::new(true));
    let running_thread = running.clone();
    let app_thread = app.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            if !running_thread.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — shell exited
                Ok(n) => {
                    if !running_thread.load(Ordering::Relaxed) {
                        break;
                    }
                    let encoded =
                        base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_thread.emit("pty-output", encoded);
                }
                Err(_) => break,
            }
        }
        let _ = app_thread.emit("pty-exit", ());
    });

    *guard = Some(PtySession {
        master: pair.master,
        writer,
        child,
        running,
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(app: AppHandle, data: String) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = guard.as_mut() {
        // Ignore write errors (e.g. the shell already exited); the reader
        // thread will emit pty-exit and the panel will close.
        let _ = session.writer.write_all(data.as_bytes());
        let _ = session.writer.flush();
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = guard.as_ref() {
        // Ignore resize errors on a dead pty.
        let _ = session.master.resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = guard.take() {
        session.running.store(false, Ordering::Relaxed);
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
