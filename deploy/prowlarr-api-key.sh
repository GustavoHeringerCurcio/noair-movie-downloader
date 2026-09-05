#!/bin/bash
# Pins Prowlarr's API key to the value in .env (PROWLARR_API_KEY).
#
# Prowlarr (this build) ignores PROWLARR__* environment overrides and generates
# a random ApiKey on first boot, which breaks backend auth whenever the
# prowlarr-config volume is recreated. linuxserver/prowlarr runs this file from
# /custom-cont-init.d before the app starts, so we seed config.xml on first run
# and re-apply the pinned key on every boot. Keep .env as the single source of
# truth; changing the key in the UI is reverted on the next restart.
set -euo pipefail

KEY="${PROWLARR_API_KEY:-}"
if [ -z "$KEY" ]; then
  echo "[prowlarr-api-key] PROWLARR_API_KEY not set; leaving config.xml untouched"
  exit 0
fi

CONF="/config/config.xml"
PUID_VAL="${PUID:-1000}"
PGID_VAL="${PGID:-1000}"

if [ ! -f "$CONF" ]; then
  echo "[prowlarr-api-key] seeding $CONF with pinned ApiKey"
  cat > "$CONF" <<EOF
<Config>
  <BindAddress>*</BindAddress>
  <Port>9696</Port>
  <SslPort>6969</SslPort>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>True</LaunchBrowser>
  <ApiKey>$KEY</ApiKey>
  <AuthenticationMethod>Forms</AuthenticationMethod>
  <AuthenticationRequired>Enabled</AuthenticationRequired>
  <Branch>master</Branch>
  <LogLevel>info</LogLevel>
  <SslCertPath></SslCertPath>
  <SslCertPassword></SslCertPassword>
  <UrlBase></UrlBase>
  <InstanceName>Prowlarr</InstanceName>
  <UpdateMechanism>Docker</UpdateMechanism>
</Config>
EOF
else
  if grep -q "<ApiKey>" "$CONF"; then
    echo "[prowlarr-api-key] applying pinned ApiKey"
    sed -i "s#<ApiKey>[^<]*</ApiKey>#<ApiKey>$KEY</ApiKey>#" "$CONF"
  else
    echo "[prowlarr-api-key] inserting pinned ApiKey"
    sed -i "s#<Config>#<Config>\n  <ApiKey>$KEY</ApiKey>#" "$CONF"
  fi
fi

chown "$PUID_VAL:$PGID_VAL" "$CONF"
chmod 664 "$CONF"
echo "[prowlarr-api-key] done"
