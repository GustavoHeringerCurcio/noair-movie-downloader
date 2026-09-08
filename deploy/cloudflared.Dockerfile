# Wrapper for the official cloudflare/cloudflared image.
#
# The official image is now `FROM scratch` (no /bin/sh), so it cannot run the
# restart-loop / URL-extraction entrypoint script in deploy/cloudflared-entrypoint.sh.
# This layers the official binary (and its CA certs) onto a minimal Alpine base
# that does ship /bin/sh, so the existing script runs unchanged and keeps
# working across future cloudflared image changes.
FROM cloudflare/cloudflared:latest AS cloudflared

FROM alpine:3.20
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=cloudflared /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
