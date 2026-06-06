param(
  [string]$OutputDir = "assets"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outDirPath = Join-Path $root $OutputDir
$pngPath = Join-Path $outDirPath "icon.png"
$icoPath = Join-Path $outDirPath "icon.ico"

New-Item -ItemType Directory -Force -Path $outDirPath | Out-Null

Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Rectangle 0, 0, $size, $size),
  [System.Drawing.Color]::FromArgb(255, 8, 13, 28),
  [System.Drawing.Color]::FromArgb(255, 28, 38, 76),
  45
)
$graphics.FillRectangle($bgBrush, 0, 0, $size, $size)

$glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 129, 140, 248))
$graphics.FillEllipse($glowBrush, 34, 30, 190, 190)

$bodyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 18, 27, 51))
$outlinePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 129, 140, 248), 10)
$accentPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 45, 212, 191), 9)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 232, 240))

$padRect = New-Object System.Drawing.Rectangle 42, 76, 172, 106
$radius = 38
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($padRect.X, $padRect.Y, $radius, $radius, 180, 90)
$path.AddArc(($padRect.Right - $radius), $padRect.Y, $radius, $radius, 270, 90)
$path.AddArc(($padRect.Right - $radius), ($padRect.Bottom - $radius), $radius, $radius, 0, 90)
$path.AddArc($padRect.X, ($padRect.Bottom - $radius), $radius, $radius, 90, 90)
$path.CloseFigure()
$graphics.FillPath($bodyBrush, $path)
$graphics.DrawPath($outlinePen, $path)

$graphics.DrawLine($accentPen, 74, 128, 116, 128)
$graphics.DrawLine($accentPen, 95, 107, 95, 149)
$graphics.FillEllipse($whiteBrush, 150, 108, 16, 16)
$graphics.FillEllipse($whiteBrush, 176, 133, 16, 16)

$font = New-Object System.Drawing.Font("Segoe UI", 42, [System.Drawing.FontStyle]::Bold)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("GT", $font, $whiteBrush, (New-Object System.Drawing.RectangleF 0, 174, 256, 58), $format)

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $stream.ToArray())

$graphics.Dispose()
$bitmap.Dispose()
$bgBrush.Dispose()
$glowBrush.Dispose()
$bodyBrush.Dispose()
$outlinePen.Dispose()
$accentPen.Dispose()
$whiteBrush.Dispose()
$font.Dispose()
$format.Dispose()
$path.Dispose()
$writer.Dispose()
$stream.Dispose()

Write-Host "Icon generated:"
Write-Host "  $icoPath"
Write-Host "  $pngPath"
