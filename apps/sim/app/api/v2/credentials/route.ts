import {
  v2CreateServiceAccountCredentialContract,
  v2ListCredentialsContract,
} from '@/lib/api/contracts/v2/credentials'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listWorkspaceCredentials } from '@/lib/credentials/application/list-workspace-credentials'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { toV2Credential } from '@/lib/credentials/application/presentation'
import { createServiceAccountCredentialUseCase } from '@/lib/credentials/application/service-account'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const credentialWorkspaceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
})

/** Every param that changes which credentials, in which order, this list returns. */
function credentialCursorFilters(query: {
  workspaceId: string
  type?: string
  providerId?: string
  search?: string
}) {
  return cursorScopeKey(cursorRoute(v2ListCredentialsContract), {
    workspaceId: query.workspaceId,
    type: query.type,
    providerId: query.providerId,
    search: query.search,
  })
}

/** GET /api/v2/credentials — List the credentials the caller can see in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListCredentialsContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.listConnections,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: credentialWorkspaceErrorPolicy,
  mapInput: ({ query }) => ({
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      credentialCursorFilters(query)
    ),
  }),
  useCase: listWorkspaceCredentials,
  present: ({ credentials, nextCursorKeys }, { query }) => ({
    data: credentials.map(toV2Credential),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      credentialCursorFilters(query)
    ),
  }),
})

/** POST /api/v2/credentials — Create and verify a service-account credential. */
export const POST = defineV2JsonRoute({
  contract: v2CreateServiceAccountCredentialContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.createServiceAccount,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: credentialWorkspaceErrorPolicy,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    providerId: body.providerId,
    displayName: body.displayName,
    description: body.description,
    id: body.id,
    ...body.credentials,
  }),
  useCase: createServiceAccountCredentialUseCase,
  present: ({ credential, hasServiceAccountKey, role }) => ({
    data: toV2Credential({ ...credential, hasServiceAccountKey, role }),
  }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})
