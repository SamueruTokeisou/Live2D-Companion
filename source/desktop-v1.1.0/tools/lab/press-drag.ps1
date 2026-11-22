param(
  [int]$sx = 0,
  [int]$sy = 0,
  [int]$steps = 60,
  [int]$stepPx = 3,
  [int]$sleepMs = 6
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
[M]::SetCursorPos($sx, $sy) | Out-Null
Start-Sleep -Milliseconds 250
[M]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # 左键按下
Start-Sleep -Milliseconds 120
for ($i = 1; $i -le $steps; $i++) {
  [M]::mouse_event(0x0001, $stepPx, 0, 0, [IntPtr]::Zero)  # 相对移动
  Start-Sleep -Milliseconds $sleepMs
}
Start-Sleep -Milliseconds 120
[M]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # 左键松开
