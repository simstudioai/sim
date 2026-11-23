/**
 * Shared 403 messages so surfaces gating on API-key workspace scope,
 * `workspace.allowPersonalApiKeys`, or a key's read-only access reject with
 * identical wording.
 */

export const WORKSPACE_KEY_SCOPE_DENIED = 'API key is not authorized for this workspace'

export const PERSONAL_KEY_DENIED = 'Personal API keys are not allowed for this workspace'

/** The 401 an expired key answers with, so its holder knows to replace it rather than recheck it. */
export const API_KEY_EXPIRED = 'API key has expired'

export const READ_ONLY_API_KEY_DENIED =
  'This API key is read-only and cannot perform this operation. Use a full-access API key.'
