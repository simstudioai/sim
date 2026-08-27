import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'

/**
 * A caller naming a workspace it cannot reach must not be able to tell that
 * refusal apart from a workspace that does not exist. Both answer
 * `404 "Workspace not found"` — the message the unknown-workspace path in
 * `get-public-workspace` and `list-public-workspace-members` already uses, so
 * the two responses are byte-identical.
 */
export const v2WorkspaceErrorPolicies = {
  concealWorkspaceAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workspace not found',
  }),
} as const
