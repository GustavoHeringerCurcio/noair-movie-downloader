#!/bin/sh
# noAir remote-access entrypoint (beta). Runs cloudflared and publishes the
# public URL to /data/url (shared with the backend via the remoteaccess volume)
# so the app's Settings -> Remote access can show it.
#
# Modes:
#   - Quick tunnel (default): CLOUDFLARE_TUNNEL_TOKEN is empty -> run a quick
#     tunnel against the frontend and extract the ephemeral *.trycloudflare.com
#     URL from stdout. The URL changes on every (re)start.
#   - Named tunnel: CLOUDFLARE_TUNNEL_TOKEN is set -> `cloudflared tunnel run`
#     using the token; the stable URL is CLOUDFLARE_TUNNEL_HOSTNAME (configured
#     in the Cloudflare dashboard) and is written to /data/url verbatim.
set -u

TARGET="http://frontend:80"
URL_FILE="/data/url"

write_url() {
  printf '%s' "$1" > "$URL_FILE"
}

# Named tunnel: token + hostname are both configured in the Cloudflare dashboard.
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  if [ -n "${CLOUDFLARE_TUNNEL_HOSTNAME:-}" ]; then
    write_url "https://${CLOUDFLARE_TUNNEL_HOSTNAME}"
  fi
  exec cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN"
fi

# Quick tunnel loop: restart on crash; re-extract the (new) URL each time.
while true; do
  cloudflared tunnel --no-autoupdate --url "$TARGET" 2>&1 | while IFS= read -r line; do
    echo "$line"
    # cloudflared prints the assigned URL like:
    #   https://<random>.trycloudflare.com
    case "$line" in
      *trycloudflare.com*) write_url "$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -n 1)";;
    esac
  done
  echo "cloudflared exited; restarting in 5s" >&2
  sleep 5
done
