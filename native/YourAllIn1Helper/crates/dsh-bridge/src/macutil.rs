//! macOS Unix socket, parent-process watch, and data-directory lock.
//!
//! The Host creates a fresh `0700` directory and passes its absolute socket path
//! as `--pipe-name`. Native does not derive that path from its own `TMPDIR`:
//! the spawned process uses an isolated temp directory. The path must be
//! absolute, at most 103 bytes, end in `/s`, and have a `dsh-` plus six
//! character parent directory owned by this user at mode `0700` and not a
//! symlink. This process binds only when the socket is absent, unlinks a
//! socket it created, and does not remove the directory or replace an old socket.

use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::net::{UnixListener, UnixStream};
use tokio::sync::watch;

use crate::service::{BridgeConfig, BridgeService};
use crate::session::serve_connection;

pub struct InstanceLock {
    file: std::fs::File,
}

impl InstanceLock {
    pub fn acquire(dir: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(dir.join("instance.lock"))
            .map_err(|_| "data directory lock could not be opened".to_string())?;
        let locked = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if locked != 0 {
            return Err("data directory is locked by another instance".to_string());
        }
        Ok(Self { file })
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

pub struct SocketListener {
    listener: UnixListener,
    socket_path: PathBuf,
    created: bool,
}

impl SocketListener {
    pub fn bind(path: &str) -> Result<Self, String> {
        validate_socket_path(path)?;
        let socket_path = PathBuf::from(path);
        match fs::symlink_metadata(&socket_path) {
            Ok(_) => return Err("unix socket already exists".to_string()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err("unix socket could not be created".to_string()),
        }
        let listener = UnixListener::bind(&socket_path).map_err(|_| {
            if socket_path.exists() {
                "unix socket already exists".to_string()
            } else {
                "unix socket could not be created".to_string()
            }
        })?;
        if let Err(err) = restrict_socket(&socket_path) {
            drop(listener);
            let _ = fs::remove_file(&socket_path);
            return Err(err);
        }
        Ok(Self {
            listener,
            socket_path,
            created: true,
        })
    }

    pub async fn accept(&self) -> io::Result<UnixStream> {
        self.listener.accept().await.map(|(stream, _)| stream)
    }
}

impl Drop for SocketListener {
    fn drop(&mut self) {
        if self.created {
            let _ = fs::remove_file(&self.socket_path);
            self.created = false;
        }
    }
}

pub fn validate_socket_path(pipe_name: &str) -> Result<(), String> {
    if pipe_name.len() > 103 {
        return Err("pipe name is longer than 103 bytes".to_string());
    }
    if !pipe_name.starts_with('/') || pipe_name.ends_with('/') || pipe_name.contains("//") {
        return Err("pipe name must be an absolute path".to_string());
    }
    let path = Path::new(pipe_name);
    if !path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::CurDir | std::path::Component::ParentDir
            )
        })
    {
        return Err("pipe name must be an absolute path".to_string());
    }
    if path.file_name().and_then(|name| name.to_str()) != Some("s") {
        return Err("pipe name must end with /s".to_string());
    }
    let Some(parent) = path.parent() else {
        return Err("pipe name parent directory is not available".to_string());
    };
    let Some(dir_name) = parent.file_name().and_then(|name| name.to_str()) else {
        return Err("pipe name must be <absolute>/dsh-<6 alphanumerics>/s".to_string());
    };
    if !is_private_dir_name(dir_name) {
        return Err("pipe name must be <absolute>/dsh-<6 alphanumerics>/s".to_string());
    }
    private_directory(parent)
}

fn restrict_socket(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| {
        "unix socket permissions could not be set".to_string()
    })?;
    let mode = fs::symlink_metadata(path)
        .map_err(|_| "unix socket permissions could not be set".to_string())?
        .permissions()
        .mode()
        & 0o777;
    if mode != 0o600 {
        return Err("unix socket permissions could not be set".to_string());
    }
    Ok(())
}

fn is_private_dir_name(name: &str) -> bool {
    let Some(token) = name.strip_prefix("dsh-") else {
        return false;
    };
    token.len() == 6 && token.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn private_directory(dir: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(dir)
        .map_err(|_| "pipe name parent directory is not available".to_string())?;
    if meta.file_type().is_symlink() {
        return Err("pipe name parent directory must not be a symlink".to_string());
    }
    if !meta.is_dir() {
        return Err("pipe name parent directory must be a directory".to_string());
    }
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    if meta.uid() != unsafe { libc::getuid() } {
        return Err("pipe name parent directory must be owned by the current user".to_string());
    }
    if meta.permissions().mode() & 0o777 != 0o700 {
        return Err("pipe name parent directory must be mode 0700".to_string());
    }
    Ok(())
}

pub fn accept_peer(stream: &UnixStream, parent_pid: u32) -> bool {
    match peer_credentials(stream) {
        Ok((pid, uid)) => pid == parent_pid && pid != 0 && uid == unsafe { libc::getuid() },
        Err(_) => false,
    }
}

fn peer_credentials(stream: &UnixStream) -> io::Result<(u32, u32)> {
    let fd = stream.as_raw_fd();
    let mut uid = 0;
    let mut gid = 0;
    if unsafe { libc::getpeereid(fd, &mut uid, &mut gid) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let mut pid: libc::pid_t = -1;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let ok = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            &mut pid as *mut libc::pid_t as *mut libc::c_void,
            &mut len,
        )
    };
    if ok != 0 || pid <= 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((pid as u32, uid))
}

pub fn watch_parent(pid: u32) -> Result<watch::Receiver<bool>, String> {
    if pid == 0 || pid > i32::MAX as u32 {
        return Err("parent process cannot be watched".to_string());
    }
    let queue = Kqueue::new()?;
    let mut change = unsafe { std::mem::zeroed::<libc::kevent>() };
    change.ident = pid as libc::uintptr_t;
    change.filter = libc::EVFILT_PROC;
    change.flags = libc::EV_ADD | libc::EV_RECEIPT;
    change.fflags = libc::NOTE_EXIT;
    let mut event = unsafe { std::mem::zeroed::<libc::kevent>() };
    let ready = unsafe { libc::kevent(queue.0, &change, 1, &mut event, 1, std::ptr::null()) };
    if ready < 0 || (event.flags & libc::EV_ERROR) != 0 && event.data != 0 {
        return Err("parent process cannot be watched".to_string());
    }
    let (tx, rx) = watch::channel(false);
    std::thread::Builder::new()
        .name("dsh-bridge-parent".to_string())
        .spawn(move || {
            let _queue = queue;
            let mut event = unsafe { std::mem::zeroed::<libc::kevent>() };
            loop {
                let ready = unsafe {
                    libc::kevent(_queue.0, std::ptr::null(), 0, &mut event, 1, std::ptr::null())
                };
                if ready > 0 {
                    let _ = tx.send(true);
                    break;
                }
                if ready < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
                    break;
                }
            }
        })
        .map_err(|_| "parent watcher could not start".to_string())?;
    Ok(rx)
}

struct Kqueue(libc::c_int);

impl Kqueue {
    fn new() -> Result<Self, String> {
        let fd = unsafe { libc::kqueue() };
        if fd < 0 {
            return Err("parent process cannot be watched".to_string());
        }
        unsafe {
            libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC);
        }
        Ok(Self(fd))
    }
}

impl Drop for Kqueue {
    fn drop(&mut self) {
        unsafe {
            libc::close(self.0);
        }
    }
}

pub async fn serve(config: BridgeConfig) -> Result<(), String> {
    let mut parent_exit = watch_parent(config.parent_pid)?;
    let _lock = InstanceLock::acquire(&config.data_dir)?;
    let service = Arc::new(tokio::sync::Mutex::new(
        BridgeService::open_with_roots(
            &config.data_dir,
            &config.allow_read_roots,
            &config.allow_write_roots,
        )
        .map_err(|err| err)?,
    ));
    eprintln!(
        "dsh-toolbox-native: listening for instance {}",
        config.instance_id
    );
    let listener = SocketListener::bind(&config.pipe_name)?;

    loop {
        if *parent_exit.borrow() {
            break;
        }
        tokio::select! {
            biased;
            changed = parent_exit.changed() => {
                if changed.is_err() || *parent_exit.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                let stream = accepted.map_err(|_| "unix socket connection failed".to_string())?;
                if accept_peer(&stream, config.parent_pid) {
                    let (reader, writer) = tokio::io::split(stream);
                    let _stop = serve_connection(
                        reader,
                        writer,
                        Arc::clone(&service),
                        config.instance_id.clone(),
                        parent_exit.clone(),
                    )
                    .await;
                    eprintln!("dsh-toolbox-native: session ended");
                    let mut guard = service.lock().await;
                    guard.shutdown_kernel().map_err(|err| err.message)?;
                    return Ok(());
                }
                eprintln!("dsh-toolbox-native: rejected a socket client that is not the parent process");
            }
        }
    }

    let mut guard = service.lock().await;
    guard.shutdown_kernel().map_err(|err| err.message)?;
    Ok(())
}

trait AsRawFdUnix {
    fn as_raw_fd(&self) -> libc::c_int;
}

impl AsRawFdUnix for std::fs::File {
    fn as_raw_fd(&self) -> libc::c_int {
        use std::os::unix::io::AsRawFd;
        AsRawFd::as_raw_fd(self)
    }
}

impl AsRawFdUnix for UnixStream {
    fn as_raw_fd(&self) -> libc::c_int {
        use std::os::unix::io::AsRawFd;
        AsRawFd::as_raw_fd(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    use std::sync::atomic::{AtomicU32, Ordering};

    fn endpoint_root() -> PathBuf {
        // A sibling of TMPDIR exercises independent Host/native temp paths,
        // while all fixtures remain inside this worktree and sun_path stays short.
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors().nth(4).expect("workspace root").join("build/ipc");
        fs::create_dir_all(&root).unwrap();
        root
    }

    struct PrivateDir {
        path: PathBuf,
    }

    impl PrivateDir {
        fn create() -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let root = endpoint_root();
            for _ in 0..64 {
                let n = SEQ.fetch_add(1, Ordering::Relaxed);
                let token = format!(
                    "{:06x}",
                    (std::process::id().wrapping_mul(31).wrapping_add(n)) & 0x00ff_ffff
                );
                let path = root.join(format!("dsh-{token}"));
                if path.exists() {
                    continue;
                }
                fs::create_dir(&path).unwrap();
                let mut perms = fs::metadata(&path).unwrap().permissions();
                perms.set_mode(0o700);
                fs::set_permissions(&path, perms).unwrap();
                return Self { path };
            }
            panic!("could not create a private endpoint directory");
        }

        fn socket(&self) -> String {
            format!("{}/s", self.path.display())
        }
    }

    impl Drop for PrivateDir {
        fn drop(&mut self) {
            let _ = fs::remove_file(self.path.join("s"));
            let _ = fs::remove_dir(&self.path);
        }
    }

    #[test]
    fn second_lock_in_process_fails_until_the_first_is_dropped() {
        let dir = crate::test_fixture::scoped_fixture("dsh-bridge-tests", "mac-lock");
        let first = InstanceLock::acquire(&dir).unwrap();
        let second = match InstanceLock::acquire(&dir) {
            Ok(_) => panic!("second lock succeeded"),
            Err(err) => err,
        };
        assert!(second.contains("locked by another instance"));
        drop(first);
        let _third = InstanceLock::acquire(&dir).unwrap();
    }

    #[test]
    fn explicit_pipe_name_is_accepted_outside_process_tmpdir() {
        let dir = PrivateDir::create();
        let socket = dir.socket();
        let process_tmp = std::env::var("TMPDIR").unwrap_or_default();
        let process_tmp = process_tmp.trim_end_matches('/');
        if !process_tmp.is_empty() {
            assert!(
                !socket.starts_with(process_tmp),
                "socket {socket} must not depend on process TMPDIR {process_tmp}"
            );
        }
        assert!(socket.len() <= 103, "socket path is {socket}");
        validate_socket_path(&socket).unwrap();
        assert!(validate_socket_path("dsh-abcdef/s").is_err());
        assert!(validate_socket_path(&format!("{socket}-too-long-{}", "x".repeat(80)))
            .unwrap_err()
            .contains("pipe name"));
        let mut loose = fs::metadata(&dir.path).unwrap().permissions();
        loose.set_mode(0o755);
        fs::set_permissions(&dir.path, loose).unwrap();
        assert!(validate_socket_path(&socket).unwrap_err().contains("0700"));
        let mut restored = fs::metadata(&dir.path).unwrap().permissions();
        restored.set_mode(0o700);
        fs::set_permissions(&dir.path, restored).unwrap();

        let link = dir.path.parent().unwrap().join("dsh-symlnk");
        let _ = fs::remove_file(&link);
        std::os::unix::fs::symlink(&dir.path, &link).unwrap();
        let linked = format!("{}/s", link.display());
        assert!(validate_socket_path(&linked).unwrap_err().contains("symlink"));
        let _ = fs::remove_file(&link);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn bind_creates_a_private_socket_and_refuses_an_existing_one() {
        let dir = PrivateDir::create();
        let socket = dir.socket();
        let listener = SocketListener::bind(&socket).unwrap();
        let mode = fs::symlink_metadata(&socket).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        match SocketListener::bind(&socket) {
            Ok(_) => panic!("existing socket was bound"),
            Err(err) => assert!(err.contains("already exists")),
        }
        assert!(fs::symlink_metadata(&socket).is_ok());
        drop(listener);
        assert!(!socket_path_exists(&socket));
        assert!(dir.path.is_dir());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn peer_must_be_this_process_and_parent_exit_is_observed() {
        let dir = PrivateDir::create();
        let socket = dir.socket();
        let listener = SocketListener::bind(&socket).unwrap();
        let client = UnixStream::connect(&socket);
        let (accepted, client) = tokio::join!(listener.accept(), client);
        let stream = accepted.unwrap();
        let _client = client.unwrap();
        assert!(accept_peer(&stream, std::process::id()));
        assert!(!accept_peer(&stream, std::process::id().wrapping_add(1)));
        drop(_client);
        drop(stream);
        drop(listener);

        let mut child = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let mut watch = watch_parent(child.id()).unwrap();
        assert!(!*watch.borrow());
        child.kill().unwrap();
        child.wait().unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), watch.changed())
            .await
            .unwrap()
            .unwrap();
        assert!(*watch.borrow());
        assert!(watch_parent(unused_pid()).is_err());
    }

    #[test]
    fn precreated_socket_is_left_in_place() {
        let dir = PrivateDir::create();
        let socket = dir.socket();
        let _held = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&socket)
            .unwrap();
        match SocketListener::bind(&socket) {
            Ok(_) => panic!("existing socket was bound"),
            Err(err) => assert!(err.contains("already exists")),
        }
        assert!(fs::symlink_metadata(&socket).is_ok());
    }

    fn socket_path_exists(path: &str) -> bool {
        fs::symlink_metadata(path).is_ok()
    }

    fn unused_pid() -> u32 {
        let mut pid = 1_000_000u32;
        while pid < 1_000_400 {
            let alive = unsafe { libc::kill(pid as i32, 0) };
            if alive != 0 {
                let err = io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ESRCH) {
                    return pid;
                }
            }
            pid += 1;
        }
        panic!("could not find an unused pid");
    }
}
