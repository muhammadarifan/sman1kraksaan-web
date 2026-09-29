#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY="${REPOSITORY:-avoocreator/sman1kraksaan-web}"
APP_HOME="${APP_HOME:-/home/app}"
RELEASES_DIR="${RELEASES_DIR:-$APP_HOME/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_HOME/current}"
ENV_FILE="${ENV_FILE:-$APP_HOME/public_html/.env.production}"
DOWNLOAD_URL="https://github.com/$REPOSITORY/releases/download/deployment-latest"

for command in curl sha256sum tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

mkdir -p "$RELEASES_DIR"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$APP_HOME/.deploy.lock"
  if ! flock -n 9; then
    echo "Another deployment is already running." >&2
    exit 1
  fi
fi

temporary_dir="$(mktemp -d)"
release_id="$(date -u +%Y%m%d%H%M%S)"
release_dir="$RELEASES_DIR/$release_id"

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

mkdir "$release_dir"
tar -xzf "$temporary_dir/deployment.tar.gz" -C "$release_dir"

if [[ ! -f "$release_dir/server.js" ]]; then
  echo "Invalid deployment: server.js is missing." >&2
  rm -rf "$release_dir"
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$release_dir/.env.production"
  chmod 600 "$release_dir/.env.production"
else
  echo "Environment file not found; using variables configured in Webuzo."
fi

next_link="$APP_HOME/.current.$release_id"
ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$CURRENT_LINK"

echo "Deployment prepared: $release_dir"
echo "Current release: $CURRENT_LINK"
echo "Restart the application from Webuzo to make it live."
