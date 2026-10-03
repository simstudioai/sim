import type { WorkspaceDelegationPolicy } from '@/lib/core/application'

export const SANDBOX_DELEGATION_AUDIENCE = 'sim:sandboxes'

/**
 * Copilot acts on sandboxes as the person it serves, within the workspace the
 * server bound the tool call to; no narrower resource scope applies.
 */
export const sandboxDelegationPolicy = {
  audience: SANDBOX_DELEGATION_AUDIENCE,
  isWithinScope: () => true,
} as const satisfies WorkspaceDelegationPolicy<{
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}>
