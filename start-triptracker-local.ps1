$env:PORT = [Environment]::GetEnvironmentVariable("PORT", "User")
$env:HTTPS_PORT = [Environment]::GetEnvironmentVariable("HTTPS_PORT", "User")
$env:TRIPTRACKER_SMTP_USER = [Environment]::GetEnvironmentVariable("TRIPTRACKER_SMTP_USER", "User")
$env:TRIPTRACKER_SMS_TO = [Environment]::GetEnvironmentVariable("TRIPTRACKER_SMS_TO", "User")
$env:TRIPTRACKER_SMTP_APP_PASSWORD = [Environment]::GetEnvironmentVariable("TRIPTRACKER_SMTP_APP_PASSWORD", "User")
$env:TRIPTRACKER_HTTPS_CERT_PATH = [Environment]::GetEnvironmentVariable("TRIPTRACKER_HTTPS_CERT_PATH", "User")
$env:TRIPTRACKER_HTTPS_KEY_PATH = [Environment]::GetEnvironmentVariable("TRIPTRACKER_HTTPS_KEY_PATH", "User")
$env:TRIPTRACKER_HTTPS_CA_PATH = [Environment]::GetEnvironmentVariable("TRIPTRACKER_HTTPS_CA_PATH", "User")
$env:TRIPTRACKER_FORCE_HTTPS = [Environment]::GetEnvironmentVariable("TRIPTRACKER_FORCE_HTTPS", "User")

$env:TRIPTRACKER_APNS_TEAM_ID = [Environment]::GetEnvironmentVariable("TRIPTRACKER_APNS_TEAM_ID", "User")
$env:TRIPTRACKER_APNS_KEY_ID = [Environment]::GetEnvironmentVariable("TRIPTRACKER_APNS_KEY_ID", "User")
$env:TRIPTRACKER_APNS_KEY_PATH = [Environment]::GetEnvironmentVariable("TRIPTRACKER_APNS_KEY_PATH", "User")
$env:TRIPTRACKER_APNS_BUNDLE_ID = [Environment]::GetEnvironmentVariable("TRIPTRACKER_APNS_BUNDLE_ID", "User")
$env:TRIPTRACKER_PUSH_REGISTRATION_SECRET = [Environment]::GetEnvironmentVariable("TRIPTRACKER_PUSH_REGISTRATION_SECRET", "User")

node server.js
