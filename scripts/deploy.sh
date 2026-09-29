#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY="${REPOSITORY:-avoocreator/sman1kraksaan-web}"
APP_HOME="${APP_HOME:-/home/app}"
DEPLOY_DIR="${DEPLOY_DIR:-$APP_HOME/public_html}"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env.production}"
APP_NAME="${APP_NAME:-sman1kraksaan}"
DOWNLOAD_URL="https://github.com/$REPOSITORY/releases/download/deployment-latest"

for command in curl sha256sum tar pm2; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$DEPLOY_DIR"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$APP_HOME/.deploy.lock"
  if ! flock -n 9; then
    echo "Another deployment is already running." >&2
    exit 1
  fi
fi

temporary_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Remove carriage returns left by environment files edited with Windows line endings.
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
OPENROUTER_API_KEY="${OPENROUTER_API_KEY%$'\r'}"
export OPENROUTER_API_KEY

if [[ -z "$OPENROUTER_API_KEY" ]]; then
  echo "OPENROUTER_API_KEY is missing from $ENV_FILE" >&2
  exit 1
fi

echo "Validating OpenRouter credentials..."
openrouter_status="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  "https://openrouter.ai/api/v1/auth/key" || true)"

if [[ "$openrouter_status" == "401" || "$openrouter_status" == "403" ]]; then
  echo "OpenRouter rejected OPENROUTER_API_KEY (HTTP $openrouter_status)." >&2
  exit 1
fi

if [[ "$openrouter_status" != "200" ]]; then
  echo "Warning: OpenRouter credential check returned HTTP ${openrouter_status:-000}." >&2
fi

echo "Downloading deployment artifact..."
curl -fsSL --retry 3 \
  "$DOWNLOAD_URL/deployment.tar.gz" \
  -o "$temporary_dir/deployment.tar.gz"
curl -fsSL --retry 3 \
  "$DOWNLOAD_URL/deployment.tar.gz.sha256" \
  -o "$temporary_dir/deployment.tar.gz.sha256"

echo "Verifying artifact..."
(
  cd "$temporary_dir"
  sha256sum -c deployment.tar.gz.sha256
)

tar -xzf "$temporary_dir/deployment.tar.gz" -C "$DEPLOY_DIR"

if [[ ! -f "$DEPLOY_DIR/server.js" ]]; then
  echo "Invalid deployment: server.js is missing." >&2
  exit 1
fi

echo "Restarting PM2 application: $APP_NAME"
pm2 restart "$APP_NAME" --update-env

echo "Deployment active: $DEPLOY_DIR"
