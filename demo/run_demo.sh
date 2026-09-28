#!/usr/bin/env bash
# Lance le serveur de démo PAP-LFI (port 3100) avec APP_SECRET.
set -euo pipefail
cd /home/chapi/.openclaw/workspace/PAP-LFI
export APP_SECRET="${APP_SECRET:-demo-secret-lenina}"
exec node demo/server.js
