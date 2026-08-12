$env:PORT = [Environment]::GetEnvironmentVariable("PORT", "User")
$env:TRIPTRACKER_SMTP_USER = [Environment]::GetEnvironmentVariable("TRIPTRACKER_SMTP_USER", "User")
$env:TRIPTRACKER_SMS_TO = [Environment]::GetEnvironmentVariable("TRIPTRACKER_SMS_TO", "User")
$env:TRIPTRACKER_SMTP_APP_PASSWORD = [Environment]::GetEnvironmentVariable("TRIPTRACKER_SMTP_APP_PASSWORD", "User")

node server.js
