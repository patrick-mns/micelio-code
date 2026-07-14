/// Cross-platform command builder. On Windows, sets `CREATE_NO_WINDOW`
/// so that child processes (git, ollama, rg, etc.) don't pop a visible
/// console window. On macOS/Linux it's a plain `Command::new(prog)`.
pub fn no_window_cmd(prog: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(prog);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}
