import {
  assertContentDeliveryDeclaration,
  assertOperationCapability,
  assertOperationOAuthPolicy,
} from '@/lib/core/application/operation'

export const FILE_COPY_DELEGATION_TTL_MS = 60_000

const policy = {
  id: 'files.copy',
  capability: 'files.use',
  oauthScope: 'api:write',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
  delegationScope: 'resource',
  delegationAudience: 'sim:files:copy',
  contentDelivery: 'none',
} as const

assertOperationCapability(policy)
assertOperationOAuthPolicy(policy)
assertContentDeliveryDeclaration(policy, policy.delegatedServices)
Object.freeze(policy.principalKinds)
Object.freeze(policy.delegatedServices)

/** Compound copies bind independent source-read and destination-write authority. */
export const fileCopyOperation = Object.freeze(policy)
