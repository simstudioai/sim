import {
  v2ListCredentialMembersContract,
  v2UpsertCredentialMemberContract,
} from '@/lib/api/contracts/v2/credentials'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import {
  listCredentialMembersUseCase,
  upsertCredentialMemberUseCase,
} from '@/lib/credentials/application/credential-members'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

const errorPolicy = createV2ResourceConcealmentPolicy({ notFoundMessage: 'Credential not found' })

export const GET = defineV2JsonRoute({
  contract: v2ListCredentialMembersContract,
  operation: credentialOperations.listMembers,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy,
  mapInput: ({ params, query }) => ({
    credentialId: params.credentialId,
    assertedWorkspaceId: query.workspaceId,
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListCredentialMembersContract, params), {
        workspaceId: query.workspaceId,
      })
    ),
  }),
  useCase: listCredentialMembersUseCase,
  present: ({ members, nextCursorKeys }, { params, query }) => ({
    data: members.map((member) => ({
      ...member,
      joinedAt: member.joinedAt?.toISOString() ?? null,
    })),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListCredentialMembersContract, params), {
        workspaceId: query.workspaceId,
      })
    ),
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2UpsertCredentialMemberContract,
  operation: credentialOperations.upsertMember,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy,
  mapInput: ({ params, query, body }) => ({
    ...body,
    credentialId: params.credentialId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: upsertCredentialMemberUseCase,
  present: ({ targetUserId, role, created }) => ({ data: { userId: targetUserId, role, created } }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})
