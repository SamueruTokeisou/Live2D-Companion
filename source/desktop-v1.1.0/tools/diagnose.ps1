<#
  诊断报告：把「打不开 / 挂载没反应」需要的信息一次性收集成 TXT，直接发给作者或 AI 会话。
  收集内容：系统版本、显卡/驱动、屏幕、exe 路径、设置、挂载解析、日志、模型目录。
  不联网、不上传，只在 exe 旁边生成一个「诊断报告.txt」。
#>
$ErrorActionPreference = 'Continue'
$here = Split-Path $PSCommandPath -Parent
$appDir = Split-Path $here -Parent

function Sec($t) { "" ; "===== $t =====" }
function Line($k, $v) { "{0,-16}{1}" -f ($k + '：'), $v }

"Live2D 桌宠 诊断报告"
"生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
"程序目录：$appDir"

Sec '系统'
$os = Get-CimInstance Win32_OperatingSystem
Line '系统' ($os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber)
Line '架构' $env:PROCESSOR_ARCHITECTURE
Line '电源/会话' ("交互式=" + [Environment]::UserInteractive)

Sec '显卡（透明窗口崩溃多半在这里）'
Get-CimInstance Win32_VideoController | ForEach-Object {
  Line '显卡' ($_.Name + ' | 驱动 ' + $_.DriverVersion + ' | ' + $_.VideoModeDescription)
}

Sec '屏幕'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  Line '显示器' ($_.DeviceName + ' ' + $_.Bounds.Width + 'x' + $_.Bounds.Height + ' 主屏=' + $_.Primary)
}

Sec '程序文件'
$exe = Get-ChildItem $appDir -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
  Line 'exe' $exe.FullName
  Line '大小' ("{0:N1} MB" -f ($exe.Length / 1MB))
  Line '文件版本' $exe.VersionInfo.FileVersion
}
foreach ($f in 'resources\app\app\main.mjs', 'resources\app\vendor\live2dcubismcore.min.js', 'resources\app\app\firstrun.html', 'tools\shrink-textures.ps1') {
  Line '关键文件' ("{0} -> {1}" -f $f, (Test-Path (Join-Path $appDir $f)))
}
Line 'model 目录' (Test-Path (Join-Path $appDir 'model'))

Sec '设置文件'
$home_ = if ($env:STAGE_HOME) { $env:STAGE_HOME } else { Join-Path $env:APPDATA 'live2d-stage' }
$sf = Join-Path $home_ 'settings.json'
if (Test-Path $sf) { Line '路径' $sf; Get-Content $sf -Raw -Encoding UTF8 } else { Line '路径' "$sf  （不存在 = 从没成功启动过）" }
$bf = Join-Path $home_ 'boot.json'
if (Test-Path $bf) { Sec '上次启动标记'; Get-Content $bf -Raw -Encoding UTF8 }

Sec '挂载 / 模型解析'
# 这一段专门给「拖进去 / 粘路径后没反应」用：把 settings 里的模型路径按应用的方式解析一遍，
# 并检查引号、文件存在、model3.json 引用是否齐全。AI 拿到这几行就能直接判断卡在哪。
$modelRaw = $null
try { $modelRaw = (Get-Content $sf -Raw -Encoding UTF8 | ConvertFrom-Json).model } catch {}
if ($modelRaw) {
  Line 'settings.model' $modelRaw
  Line '带引号/空格' (($modelRaw -match '^\s*["'']') -or ($modelRaw -ne $modelRaw.Trim()))
  $clean = $modelRaw.Trim().Trim('"').Trim("'")
  $modelAbs = if ([System.IO.Path]::IsPathRooted($clean)) { $clean } else { Join-Path $appDir $clean }
  Line '解析为' $modelAbs
  Line '文件存在' (Test-Path $modelAbs)
  if (Test-Path $modelAbs) {
    try {
      $mj = Get-Content $modelAbs -Raw -Encoding UTF8 | ConvertFrom-Json
      $fr = $mj.FileReferences
      $mdir = Split-Path $modelAbs -Parent
      if ($fr.Moc) { Line 'Moc' ($fr.Moc + '  存在=' + (Test-Path (Join-Path $mdir $fr.Moc))) }
      $tex0 = @($fr.Textures) | Select-Object -First 1
      if ($tex0) { Line '首张贴图' ($tex0 + '  存在=' + (Test-Path (Join-Path $mdir $tex0))) }
      $refs = @()
      if ($fr.Moc) { $refs += $fr.Moc }
      if ($fr.Physics) { $refs += $fr.Physics }
      if ($fr.DisplayInfo) { $refs += $fr.DisplayInfo }
      if ($fr.Textures) { $refs += @($fr.Textures) }
      if ($fr.Expressions) { $refs += @($fr.Expressions | ForEach-Object { $_.File }) }
      $miss = @($refs | Where-Object { $_ -and -not (Test-Path (Join-Path $mdir $_)) })
      Line '缺失引用' ($miss.Count.ToString() + ' 个')
      foreach ($m in ($miss | Select-Object -First 8)) { "  - $m" }
    } catch { Line 'model3.json' ('解析失败：' + $_.Exception.Message) }
  } else {
    Line '提示' 'settings 里的模型路径不存在（重新挂载或改路径）'
  }
} else {
  Line 'settings.model' '(空：走 exe 旁 model/ 或首次运行引导)'
}
$epFile = Join-Path $env:USERPROFILE '.dsh\live2d\endpoint.json'
if (Test-Path $epFile) {
  try {
    $ep = Get-Content $epFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $alive = $false
    if ($ep.pid) { try { $alive = [bool](Get-Process -Id ([int]$ep.pid) -ErrorAction Stop) } catch {} }
    Line '运行中实例' ('pid=' + $ep.pid + ' 存活=' + $alive + ' 端口=' + $ep.port)
  } catch {}
}

Sec '日志（最后 120 行）'
$logs = @()
$logs += Get-ChildItem (Join-Path $home_ 'logs') -Filter *.log -ErrorAction SilentlyContinue
$logs += Get-ChildItem $appDir -Filter *.log -ErrorAction SilentlyContinue
if ($logs.Count -eq 0) { "没有日志文件（说明程序还没跑到写日志那一步，或从没成功启动过）" }
foreach ($l in $logs) {
  "--- $($l.FullName) ---"
  Get-Content $l.FullName -Tail 120 -Encoding UTF8
}

Sec '模型目录内容'
$md = Join-Path $appDir 'model'
if (Test-Path $md) {
  Get-ChildItem $md -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object -First 40 | ForEach-Object { "{0,10:N1} KB  {1}" -f ($_.Length / 1KB), $_.FullName.Replace($md, '') }
} else { '(没有 model 目录)' }

Sec '进程'
Get-Process | Where-Object { $_.ProcessName -match 'Live2d|桌宠' } |
  ForEach-Object { Line '进程' ($_.Id.ToString() + ' ' + $_.ProcessName + ' ' + [math]::Round($_.WorkingSet64 / 1MB, 1) + ' MB') }

""
"报告结束。"
