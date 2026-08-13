import type { V2Credential } from '@/lib/api/contracts/v2/credentials'
import { v2ListCredentialsContract } from '@/lib/api/contracts/v2/credentials'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listWorkspaceCredentials } from '@/lib/credentials/application/list-workspace-credentials'
import { credentialOperations } from '@/lib/credentials/application/operations'
import type { VisibleWorkspaceCredential } from '@/lib/credentials/queries'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Serialize connection metadata field by field so encrypted columns can never reach the wire. */
function toV2Credential(row: VisibleWorkspaceCredential): V2Credential {
  if (row.type !== 'oauth' && row.type !== 'service_account') {
    throw new Error(`Secret credential type ${row.type} reached the credentials API`)
  }

  return {
    id: row.id,
    type: row.type,
    displayName: row.displayName,
    description: row.description,
    providerId: row.providerId,
    accountId: row.accountId,
    hasServiceAccountKey: row.hasServiceAccountKey,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

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
  errorPolicy: v2OrchestrationErrorPolicy,
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
