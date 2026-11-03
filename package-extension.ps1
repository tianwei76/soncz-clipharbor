$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$manifestText = [System.IO.File]::ReadAllText(
  (Resolve-Path -LiteralPath "manifest.json"),
  [System.Text.Encoding]::UTF8
)
$version = [regex]::Match($manifestText, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
if (-not $version) {
  throw "Cannot read version from manifest.json"
}

$zipPath = "dist/douyin-video-downloader-$version.zip"
$includePaths = @(
  "LICENSE",
  "manifest.json",
  "background.js",
  "content.js",
  "injected.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png"
)

New-Item -ItemType Directory -Force -Path "dist" | Out-Null

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open((Join-Path $root $zipPath), [IO.FileMode]::Create)
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relativePath in $includePaths) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, (Join-Path $root $relativePath), $relativePath.Replace('\', '/'),
      [IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
  $stream.Dispose()
}
Get-Item -LiteralPath $zipPath
