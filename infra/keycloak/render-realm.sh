#!/bin/sh
set -eu

OUTPUT_DIR="${KEYCLOAK_REALM_OUTPUT_DIR:-/opt/keycloak/data/import}"
OUTPUT_PATH="$OUTPUT_DIR/contest-platform-realm.json"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' ' '
}

REALM="${KEYCLOAK_REALM:-contest-platform}"
DISPLAY_NAME="${KEYCLOAK_DISPLAY_NAME:-Origin Draft}"
LOGIN_THEME="${KEYCLOAK_LOGIN_THEME:-origin-draft}"
CLIENT_ID="${KEYCLOAK_CLIENT_ID:-contest-platform-web}"
CLIENT_NAME="${KEYCLOAK_CLIENT_NAME:-contest-platform-web}"
CLIENT_PUBLIC="${KEYCLOAK_CLIENT_PUBLIC:-false}"
CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET:-replace-with-real-secret}"
WEB_ORIGIN="${KEYCLOAK_WEB_ORIGIN:-http://localhost:5173}"
REDIRECT_URIS_JSON="${KEYCLOAK_REDIRECT_URIS_JSON:-[\"${WEB_ORIGIN}/*\"]}"
WEB_ORIGINS_JSON="${KEYCLOAK_WEB_ORIGINS_JSON:-[\"${WEB_ORIGIN}\"]}"

if [ -n "${KEYCLOAK_SSL_REQUIRED:-}" ]; then
  SSL_REQUIRED="$KEYCLOAK_SSL_REQUIRED"
elif printf '%s' "$WEB_ORIGIN" | grep -q '^https://'; then
  SSL_REQUIRED="external"
else
  SSL_REQUIRED="none"
fi

mkdir -p "$OUTPUT_DIR"

cat > "$OUTPUT_PATH" <<EOF
{
  "realm": "$(json_escape "$REALM")",
  "enabled": true,
  "sslRequired": "$(json_escape "$SSL_REQUIRED")",
  "displayName": "$(json_escape "$DISPLAY_NAME")",
  "loginTheme": "$(json_escape "$LOGIN_THEME")",
  "registrationAllowed": true,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,
  "roles": {
    "realm": [
      { "name": "platform-admin" },
      { "name": "organizer" },
      { "name": "judge" },
      { "name": "entrant" }
    ]
  },
  "groups": [
    {
      "name": "organizers"
    },
    {
      "name": "judges"
    },
    {
      "name": "entrants"
    },
    {
      "name": "teams"
    }
  ],
  "clients": [
    {
      "clientId": "$(json_escape "$CLIENT_ID")",
      "name": "$(json_escape "$CLIENT_NAME")",
      "enabled": true,
      "publicClient": ${CLIENT_PUBLIC},
      "secret": "$(json_escape "$CLIENT_SECRET")",
      "redirectUris": ${REDIRECT_URIS_JSON},
      "webOrigins": ${WEB_ORIGINS_JSON},
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "protocol": "openid-connect"
    }
  ]
}
EOF

if [ "${KEYCLOAK_RENDER_ONLY:-false}" = "true" ]; then
  exit 0
fi

exec /opt/keycloak/bin/kc.sh start --import-realm
