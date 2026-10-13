#!/usr/bin/env bash
# One-click launcher (used by the Desktop app): reuses a running local server
# or starts one with dev-fresh.sh in the background, waits until it answers,
# then opens the browser. Local-only: never exposes the server to the network.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Apps launched from Finder get a minimal PATH without Homebrew/nvm.
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

PORT="${PORT:-4173}"
URL="http://localhost:${PORT}/"
LOG_FILE="${ROOT_DIR}/.gev-cache/launcher.log"
WAIT_SECONDS=90

notify_error() {
  /usr/bin/osascript -e "display dialog \"$1\" with title \"God's Eye View\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1 || true
}

is_up() {
  curl -sf -o /dev/null --max-time 2 "${URL}"
}

if is_up; then
  open "${URL}"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  notify_error "Node.js/npm was not found. Install Node.js, then try again."
  exit 1
fi
if [[ ! -d node_modules ]]; then
  notify_error "Dependencies are missing. Run npm install in the project folder once, then try again."
  exit 1
fi

mkdir -p "$(dirname "${LOG_FILE}")"
HOST=localhost PORT="${PORT}" nohup ./scripts/dev-fresh.sh >"${LOG_FILE}" 2>&1 </dev/null &

for ((i = 0; i < WAIT_SECONDS; i++)); do
  if is_up; then
    open "${URL}"
    exit 0
  fi
  sleep 1
done

notify_error "The server did not start within ${WAIT_SECONDS} seconds. Details: .gev-cache/launcher.log in the project folder."
exit 1
