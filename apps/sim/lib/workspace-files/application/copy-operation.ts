import {
  assertOperationCapability,
  assertOperationOAuthPolicy,
} from '@/lib/core/application/operation'

export const FILE_COPY_DELEGATION_TTL_MS = 60_000

const policy = {
  id: 'files.copy',
  capability: 'files.use',
  oauthScope: 'api:write',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'resource_delegated'],
  delegatedServices: ['copilot'],
  delegationAudience: 'sim:files:copy',
} as const

assertOperationCapability(policy)
assertOperationOAuthPolicy(policy)
Object.freeze(policy.principalKinds)
Object.freeze(policy.delegatedServices)

/** Compound copies bind independent source-read and destination-write authority. */
export const fileCopyOperation = Object.freeze(policy)

/**
 * Whether a copy names only workspace owners. Every workspace belongs to a Project whether or not
 * Projects are on, so only a copy that names a Project owner needs them.
 */
export function copiesWithinWorkspaces(input: {
  source: { owner: { entityType: string } }
  destination: { owner: { entityType: string } }
}): boolean {
  return (
    input.source.owner.entityType === 'workspace' &&
    input.destination.owner.entityType === 'workspace'
  )
}
