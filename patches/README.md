# Better Auth OAuth resource preservation

`@better-auth/oauth-provider@1.6.27` strips the OAuth `resource` parameter from
its authorization endpoint's query schema. This loses the audience before the
provider signs the consent request and stores the authorization code.

The version-pinned patch adds one optional string field to that schema. It does
not change signature verification, consent, PKCE, token validation, or any other
provider behavior. Sim validates the canonical Search MCP URL at its authorization
and token boundaries, then binds it to the stored opaque tokens after the provider
verifies the code and PKCE.

The PostgreSQL token-route test exercises the native signed-consent flow, including
resource tampering, and verifies issuance, refresh, audience enforcement, and the
existing API OAuth flow. Run it when changing this patch.

Remove this patch when upgrading to a provider version with native authorization
resource preservation. Review its persisted resource model and migrate Sim's
opaque-token audience binding at the same time; preserving the query alone does
not enforce an access token's audience.
