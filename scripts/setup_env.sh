#!/usr/bin/env bash
# Creates a local, git-ignored .env from .env.example with a random ORGANIZER_TOKEN.
# Never overwrites an existing .env. The token is not printed.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  echo ".env already exists; leaving it unchanged."
  exit 0
fi
token="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
sed "s|^ORGANIZER_TOKEN=.*|ORGANIZER_TOKEN=${token}|" .env.example > .env
chmod 600 .env
echo "Created .env (mode 600) with a random ORGANIZER_TOKEN. Add GEMINI_API_KEY / SARVAM_API_KEY there if available."
