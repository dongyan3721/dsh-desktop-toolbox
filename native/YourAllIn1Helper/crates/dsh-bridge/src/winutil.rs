//! Windows named pipe, current-user ACL, parent-process watch, and data-directory lock.

use std::fs::OpenOptions;
use std::io;
use std::mem;
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use std::ptr;

use tokio::net::windows::named_pipe::NamedPipeServer;
use tokio::sync::watch;
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::{
    BuildTrusteeWithSidW, SetEntriesInAclW, EXPLICIT_ACCESS_W, SET_ACCESS, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, InitializeSecurityDescriptor, SetSecurityDescriptorControl,
    SetSecurityDescriptorDacl, ACL, NO_INHERITANCE, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES,
    SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{
    LockFileEx, UnlockFileEx, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    PIPE_ACCESS_DUPLEX,
};
use windows_sys::Win32::System::IO::OVERLAPPED;
use windows_sys::Win32::System::Pipes::{
    CreateNamedPipeW, GetNamedPipeClientProcessId, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_WAIT,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
    PROCESS_SYNCHRONIZE,
};

use crate::service::{BridgeConfig, BridgeService};
use crate::session::serve_connection;

#[cfg(test)]
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

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
        let mut overlapped = unsafe { mem::zeroed::<OVERLAPPED>() };
        let locked = unsafe {
            LockFileEx(
                file.as_raw_handle() as HANDLE,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                1,
                0,
                &mut overlapped,
            )
        };
        if locked == 0 {
            return Err("data directory is locked by another instance".to_string());
        }
        Ok(Self { file })
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        let mut overlapped = unsafe { mem::zeroed::<OVERLAPPED>() };
        unsafe {
            UnlockFileEx(
                self.file.as_raw_handle() as HANDLE,
                0,
                1,
                0,
                &mut overlapped,
            );
        }
    }
}

pub async fn serve(config: BridgeConfig) -> Result<(), String> {
    let mut parent_exit = watch_parent(config.parent_pid)?;
    let _lock = InstanceLock::acquire(&config.data_dir)?;
    let service = std::sync::Arc::new(tokio::sync::Mutex::new(
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

    loop {
        if *parent_exit.borrow() {
            break;
        }
        let server = create_listening_pipe(&config.pipe_name)
            .map_err(|_| "named pipe could not be created".to_string())?;
        tokio::select! {
            biased;
            changed = parent_exit.changed() => {
                if changed.is_err() || *parent_exit.borrow() {
                    break;
                }
            }
            connected = server.connect() => {
                if connected.is_err() {
                    return Err("named pipe connection failed".to_string());
                }
                match client_process_id(&server) {
                    Ok(pid) if pid == config.parent_pid => {
                        let (reader, writer) = tokio::io::split(server);
                        let _stop = serve_connection(
                            reader,
                            writer,
                            std::sync::Arc::clone(&service),
                            config.instance_id.clone(),
                            parent_exit.clone(),
                        )
                        .await;
                        eprintln!("dsh-toolbox-native: session ended");
                        let mut guard = service.lock().await;
                        guard.shutdown_kernel().map_err(|err| err.message)?;
                        return Ok(());
                    }
                    Ok(_) | Err(_) => {
                        eprintln!("dsh-toolbox-native: rejected a pipe client that is not the parent process");
                    }
                }
            }
        }
    }

    let mut guard = service.lock().await;
    guard.shutdown_kernel().map_err(|err| err.message)?;
    Ok(())
}

pub fn watch_parent(pid: u32) -> Result<watch::Receiver<bool>, String> {
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle == 0 {
        return Err("parent process cannot be watched".to_string());
    }
    let (tx, rx) = watch::channel(false);
    std::thread::Builder::new()
        .name("dsh-bridge-parent".to_string())
        .spawn(move || {
            unsafe {
                WaitForSingleObject(handle, INFINITE);
                CloseHandle(handle);
            }
            let _ = tx.send(true);
        })
        .map_err(|_| "parent watcher could not start".to_string())?;
    Ok(rx)
}

pub fn client_process_id(server: &NamedPipeServer) -> io::Result<u32> {
    let mut pid = 0_u32;
    let ok = unsafe { GetNamedPipeClientProcessId(server.as_raw_handle() as HANDLE, &mut pid) };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(pid)
    }
}

pub fn create_listening_pipe(name: &str) -> io::Result<NamedPipeServer> {
    let acl = build_current_user_acl()?;
    let server = unsafe { create_pipe_with_acl(name, acl) };
    unsafe {
        LocalFree(acl as _);
    }
    server
}

unsafe fn create_pipe_with_acl(name: &str, acl: *mut ACL) -> io::Result<NamedPipeServer> {
    let mut descriptor: SECURITY_DESCRIPTOR = mem::zeroed();
    let descriptor_ptr = &mut descriptor as *mut SECURITY_DESCRIPTOR as PSECURITY_DESCRIPTOR;
    if InitializeSecurityDescriptor(descriptor_ptr, 1) == 0
        || SetSecurityDescriptorDacl(descriptor_ptr, 1, acl, 0) == 0
        || SetSecurityDescriptorControl(descriptor_ptr, SE_DACL_PROTECTED, SE_DACL_PROTECTED) == 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor_ptr as *mut _,
        bInheritHandle: 0,
    };
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let handle = CreateNamedPipeW(
        wide.as_ptr(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        1,
        64 * 1024,
        64 * 1024,
        0,
        &mut attributes,
    );
    if handle == 0 || handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    NamedPipeServer::from_raw_handle(handle as _)
}

fn build_current_user_acl() -> io::Result<*mut ACL> {
        with_current_user_sid(|sid| {
            let mut trustee: TRUSTEE_W = unsafe { mem::zeroed() };
            unsafe { BuildTrusteeWithSidW(&mut trustee, sid) };
            let entry = EXPLICIT_ACCESS_W {
                grfAccessPermissions: FILE_GENERIC_READ | FILE_GENERIC_WRITE,
                grfAccessMode: SET_ACCESS,
                grfInheritance: NO_INHERITANCE,
                Trustee: trustee,
            };
            let mut acl = ptr::null_mut();
            let status = unsafe { SetEntriesInAclW(1, &entry, ptr::null(), &mut acl) };
        if status != ERROR_SUCCESS {
            Err(io::Error::from_raw_os_error(status as i32))
        } else {
            Ok(acl)
        }
    })?
}

fn with_current_user_sid<T>(operation: impl FnOnce(windows_sys::Win32::Foundation::PSID) -> T) -> io::Result<T> {
    let mut token: HANDLE = 0;
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = unsafe { read_token_user(token, operation) };
    unsafe {
        CloseHandle(token);
    }
    result
}

unsafe fn read_token_user<T>(
    token: HANDLE,
    operation: impl FnOnce(windows_sys::Win32::Foundation::PSID) -> T,
) -> io::Result<T> {
    let mut needed = 0_u32;
    GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed);
    if needed == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut buffer = vec![0_u64; needed as usize / 8 + 1];
    if GetTokenInformation(
        token,
        TokenUser,
        buffer.as_mut_ptr() as *mut _,
        (buffer.len() * 8) as u32,
        &mut needed,
    ) == 0
    {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    let user = &*(buffer.as_ptr() as *const TOKEN_USER);
    Ok(operation(user.User.Sid))
}

#[cfg(test)]
fn dacl_is_current_user_only(handle: HANDLE) -> io::Result<bool> {
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_KERNEL_OBJECT};
    use windows_sys::Win32::Security::DACL_SECURITY_INFORMATION;
    let mut dacl = ptr::null_mut();
    let mut descriptor = ptr::null_mut();
    let status = unsafe {
        GetSecurityInfo(
            handle,
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    let allowed = unsafe { acl_allows_only_current_user(dacl) };
    unsafe {
        LocalFree(descriptor as _);
    }
    allowed
}

#[cfg(test)]
unsafe fn acl_allows_only_current_user(dacl: *mut ACL) -> io::Result<bool> {
    use windows_sys::Win32::Security::{EqualSid, GetAce, ACE_HEADER};
    if dacl.is_null() || (*dacl).AceCount != 1 {
        return Ok(false);
    }
    let mut ace = ptr::null_mut();
    if GetAce(dacl, 0, &mut ace) == 0 {
        return Err(io::Error::last_os_error());
    }
    let header = &*(ace as *const ACE_HEADER);
    if header.AceType != ACCESS_ALLOWED_ACE_TYPE || header.AceFlags & 0x10 != 0 {
        return Ok(false);
    }
    let sid = (ace as *const u8).add(mem::size_of::<ACE_HEADER>() + mem::size_of::<u32>());
    with_current_user_sid(|current| EqualSid(sid as _, current) != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        crate::test_fixture::scoped_fixture("dsh-bridge-tests", name)
    }

    #[test]
    fn second_lock_in_process_fails_until_the_first_is_dropped() {
        let dir = fixture("lock");
        let first = InstanceLock::acquire(&dir).unwrap();
        let second = match InstanceLock::acquire(&dir) {
            Ok(_) => panic!("second lock succeeded"),
            Err(err) => err,
        };
        assert!(second.contains("locked by another instance"));
        drop(first);
        let _third = InstanceLock::acquire(&dir).unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn pipe_dacl_grants_only_the_current_user() {
        let name = format!(
            r"\\.\pipe\dsh-bridge-acl-{}",
            uuid::Uuid::new_v4().simple()
        );
        let server = create_listening_pipe(&name).unwrap();
        let only_user = dacl_is_current_user_only(server.as_raw_handle() as HANDLE).unwrap();
        assert!(only_user, "pipe DACL must grant only the current user");
        drop(server);
    }
}
