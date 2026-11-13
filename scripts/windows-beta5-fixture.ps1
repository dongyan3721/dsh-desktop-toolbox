# Explicit synthetic Windows clipboard/hotkey fixture. No UI automation or user data reads.
param([switch]$AllowDesktop, [string]$ControlFile)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Use-ProjectEnvironment.ps1"
if (-not $AllowDesktop) { throw 'Supply -AllowDesktop for controlled OS acceptance' }
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../runtime/beta5-fixture'))
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
if (-not $ControlFile) { $ControlFile = Join-Path $fixtureRoot 'command.json' }
$resolvedControl = [IO.Path]::GetFullPath($ControlFile)
if (-not $resolvedControl.StartsWith($fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Control file must stay in the beta5 fixture directory' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ToolboxBeta5Fixture {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowExW(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr w);
 [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr w);
 [DllImport("user32.dll")] static extern bool CloseClipboard();
 [DllImport("user32.dll")] static extern bool EmptyClipboard();
 [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint fmt,IntPtr h);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags,UIntPtr bytes);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
 [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr h);
 [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterHotKey(IntPtr w,int id,uint mod,uint key);
 [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr w,int id);
 static IntPtr owner;
 public static void Start() { owner=CreateWindowExW(0,"STATIC","DSH beta5 synthetic clipboard owner",0,0,0,0,0,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero); if(owner==IntPtr.Zero) throw new Exception("owner window unavailable"); }
 static void Put(uint fmt, byte[] bytes) {
   if(!OpenClipboard(owner)) throw new Exception("clipboard temporarily unavailable");
   IntPtr h=IntPtr.Zero;
   try { if(!EmptyClipboard()) throw new Exception("clear failed");
     h=GlobalAlloc(2,(UIntPtr)bytes.Length); var ptr=GlobalLock(h); if(ptr==IntPtr.Zero) throw new Exception("allocation failed");
     Marshal.Copy(bytes,0,ptr,bytes.Length); GlobalUnlock(h);
     if(SetClipboardData(fmt,h)==IntPtr.Zero) throw new Exception("write failed"); h=IntPtr.Zero;
   } finally { if(h!=IntPtr.Zero) GlobalFree(h); CloseClipboard(); }
 }
 public static void Text() { Put(13,System.Text.Encoding.Unicode.GetBytes("DSH-BETA5-SOURCE synthetic text\0")); }
 public static void Image() {
   var data=new byte[40+16]; BitConverter.GetBytes(40).CopyTo(data,0); BitConverter.GetBytes(2).CopyTo(data,4); BitConverter.GetBytes(2).CopyTo(data,8);
   BitConverter.GetBytes((short)1).CopyTo(data,12); BitConverter.GetBytes((short)32).CopyTo(data,14); BitConverter.GetBytes(16).CopyTo(data,20);
   for(int i=40;i<data.Length;i+=4) { data[i]=20;data[i+1]=140;data[i+2]=240;data[i+3]=255; } Put(8,data);
 }
 public static void HoldKey() { if(!RegisterHotKey(owner,917,0x0002|0x0001|0x0004,0x79)) throw new Exception("synthetic key registration failed: "+Marshal.GetLastWin32Error()); }
 public static void HoldScreenshotKey() { if(!RegisterHotKey(owner,918,0x0002|0x0001,0x41)) throw new Exception("screenshot test binding unavailable: "+Marshal.GetLastWin32Error()); }
 public static void ReleaseKey() { UnregisterHotKey(owner,917); UnregisterHotKey(owner,918); }
 public static void Stop() { ReleaseKey(); DestroyWindow(owner); }
}
'@
[ToolboxBeta5Fixture]::Start()
$lastCommand = ''
try {
    Write-Output 'BETA5_FIXTURE_READY (Ctrl+Alt+Shift+F10 is the test binding)'
    while ($true) {
        if (Test-Path -LiteralPath $resolvedControl) {
            $rawCommand = Get-Content -LiteralPath $resolvedControl -Raw
            if ($rawCommand -ne $lastCommand) {
                $lastCommand = $rawCommand
                $fixtureCommand = $rawCommand | ConvertFrom-Json
                switch ($fixtureCommand.action) {
                    'text' { [ToolboxBeta5Fixture]::Text() }
                    'image' { [ToolboxBeta5Fixture]::Image() }
                    'hold-key' { [ToolboxBeta5Fixture]::HoldKey() }
                    'hold-screenshot-key' { [ToolboxBeta5Fixture]::HoldScreenshotKey() }
                    'release-key' { [ToolboxBeta5Fixture]::ReleaseKey() }
                    'quit' { return }
                    default { throw 'Unknown fixture action' }
                }
                Write-Output "BETA5_FIXTURE_DONE $($fixtureCommand.action)"
            }
        }
        Start-Sleep -Milliseconds 150
    }
} finally { [ToolboxBeta5Fixture]::Stop() }
