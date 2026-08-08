/**
 * Shared 403 messages so surfaces gating on API-key workspace scope or
 * `workspace.allowPersonalApiKeys` reject with identical wording.
 */

export const WORKSPACE_KEY_SCOPE_DENIED = 'API key is not authorized for this workspace'

export const PERSONAL_KEY_DENIED = 'Personal API keys are not allowed for this workspace'
