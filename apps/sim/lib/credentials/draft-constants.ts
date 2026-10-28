export const CREDENTIAL_DRAFT_TTL_MS = 15 * 60 * 1000
export const CREDENTIAL_DRAFT_TTL_SECONDS = CREDENTIAL_DRAFT_TTL_MS / 1000
export const OAUTH_CREDENTIAL_DRAFT_CALLBACK_PARAM = 'credentialDraftId'
/**
 * OAuth callback `error` code for a reconnect whose chosen account already backs
 * another credential in the same workspace. Its `error_description` carries the
 * message to show.
 */
export const OAUTH_CREDENTIAL_ACCOUNT_CONFLICT_ERROR = 'credential_account_conflict'
