#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY="${REPOSITORY:-avoocreator/sman1kraksaan-web}"
APP_HOME="${APP_HOME:-/home/app}"
DEPLOY_DIR="${DEPLOY_DIR:-$APP_HOME/public_html}"
DOWNLOAD_URL="https://github.com/$REPOSITORY/releases/download/deployment-latest"

for command in curl sha256sum tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

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

echo "Deployment prepared: $DEPLOY_DIR"
echo "Restart the application from Webuzo to make it live."
