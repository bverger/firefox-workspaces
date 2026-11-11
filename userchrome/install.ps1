# Installs the Sidespace userChrome.css into Firefox's default profile on
# Windows, straight from GitHub, and enables the prefs it needs. Close Firefox
# first. Run it again after an update that changes the CSS.
#
#   irm https://raw.githubusercontent.com/bverger/firefox-workspaces/main/userchrome/install.ps1 | iex
#
# Optional: set $ProfileDir first to install into another profile folder.

$ErrorActionPreference = 'Stop'
$base = 'https://raw.githubusercontent.com/bverger/firefox-workspaces/main/userchrome'
$root = Join-Path $env:APPDATA 'Mozilla\Firefox'

if (-not $ProfileDir) {
  # The [Install...] section of profiles.ini names the profile this Firefox uses.
  $ini = Join-Path $root 'profiles.ini'
  if (-not (Test-Path $ini)) { throw "No profiles.ini in $root. Is Firefox installed and opened once?" }
  $inInstall = $false
  $rel = $null
  foreach ($line in Get-Content $ini) {
    if ($line -match '^\[Install') { $inInstall = $true; continue }
    if ($line -match '^\[') { $inInstall = $false; continue }
    if ($inInstall -and $line -match '^Default=(.+)$') { $rel = $Matches[1].Trim(); break }
  }
  if (-not $rel) { throw "No default profile found in $ini" }
  $ProfileDir = Join-Path $root ($rel -replace '/', '\')
}
if (-not (Test-Path $ProfileDir)) { throw "Profile not found: $ProfileDir" }

if (Get-Process firefox -ErrorAction SilentlyContinue) {
  Write-Warning 'Firefox is running: close it completely, then start it again to see the changes.'
}

$css = (Invoke-RestMethod "$base/userChrome.css") + "`n" + (Invoke-RestMethod "$base/autohide-sidebar.css")

$chrome = Join-Path $ProfileDir 'chrome'
New-Item -ItemType Directory -Force $chrome | Out-Null
$target = Join-Path $chrome 'userChrome.css'
if ((Test-Path $target) -and -not (Select-String -Quiet -Path $target -Pattern 'Workspaces extension')) {
  Copy-Item $target "$target.bak" -Force
  Write-Host 'Existing userChrome.css saved as userChrome.css.bak'
}
[IO.File]::WriteAllText($target, $css, (New-Object Text.UTF8Encoding $false))

# user.js is applied on every start. inTitlebar=0 brings back the native title
# bar, which holds the window buttons that lived in the hidden tab strip.
$userJs = Join-Path $ProfileDir 'user.js'
foreach ($pref in @(
  'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);',
  'user_pref("browser.tabs.inTitlebar", 0);'
)) {
  if (-not ((Test-Path $userJs) -and (Select-String -Quiet -SimpleMatch -Path $userJs -Pattern $pref))) {
    Add-Content -Path $userJs -Value $pref
  }
}

Write-Host "Installed in $ProfileDir. Restart Firefox."
