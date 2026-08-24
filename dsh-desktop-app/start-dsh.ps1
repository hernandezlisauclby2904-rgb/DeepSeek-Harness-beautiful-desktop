# DeepSeek Harness 启动脚本（无窗口模式）
$ErrorActionPreference = "SilentlyContinue"

# 检查服务是否已在运行
$port = 3080
$test = New-Object System.Net.Sockets.TcpClient
try {
    $test.Connect("127.0.0.1", $port)
    $test.Close()
    $serviceRunning = $true
} catch {
    $serviceRunning = $false
}

# 如果服务未运行，启动它
if (-not $serviceRunning) {
    $nodePath = "C:\Program Files\nodejs\node.exe"
    $dshBin = "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js"
    
    if (Test-Path $nodePath) {
        Start-Process -FilePath $nodePath -ArgumentList "`"$dshBin`" web" -WindowStyle Hidden
        Start-Sleep -Seconds 5
    }
}

# 打开浏览器
Start-Process "http://127.0.0.1:$port"
