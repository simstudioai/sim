import { db } from '@sim/db'
import { shopifyInstallationScope, shopifyPrivacyRequest } from '@sim/db/schema'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { defineOperation, type OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { authorizePrivacyOperator } from '@/lib/shopify/privacy/application/authorization'
import { SHOPIFY_PRIVACY_STORES, type ShopifyPrivacyReview } from '@/lib/shopify/privacy/types'

// permission-group-exempt: this platform operations queue is restricted to current platform administrators
const listOperation = defineOperation({
  id: 'shopify.privacy.list',
  capability: 'none',
  principalKinds: ['session'],
})
// permission-group-exempt: private case evidence is restricted to current platform administrators
const readOperation = defineOperation({
  id: 'shopify.privacy.read',
  capability: 'none',
  principalKinds: ['session'],
})

const summaryColumns = {
  id: shopifyPrivacyRequest.id,
  topic: shopifyPrivacyRequest.topic,
  shopId: shopifyPrivacyRequest.shopId,
  shopDomain: shopifyPrivacyRequest.shopDomain,
  status: shopifyPrivacyRequest.status,
  assignedToUserId: shopifyPrivacyRequest.assignedToUserId,
  revision: shopifyPrivacyRequest.revision,
  receivedAt: shopifyPrivacyRequest.receivedAt,
  dueAt: shopifyPrivacyRequest.dueAt,
  escalatedAt: shopifyPrivacyRequest.escalatedAt,
  completedAt: shopifyPrivacyRequest.completedAt,
  completedByUserId: shopifyPrivacyRequest.completedByUserId,
}

function summarize(
  row: Pick<typeof shopifyPrivacyRequest.$inferSelect, keyof typeof summaryColumns>
) {
  return {
    id: row.id,
    topic: row.topic,
    shopId: row.shopId,
    shopDomain: row.shopDomain,
    status: row.status,
    assignedToUserId: row.assignedToUserId,
    revision: row.revision,
    completedByUserId: row.completedByUserId,
    receivedAt: row.receivedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

interface ListPrivacyInput {
  after?: string
  limit: number
  openOnly: boolean
}

async function listRequests(input: ListPrivacyInput) {
  const limit = Math.min(100, Math.max(1, input.limit))
  const rows = await db
    .select(summaryColumns)
    .from(shopifyPrivacyRequest)
    .where(
      and(
        input.openOnly ? isNull(shopifyPrivacyRequest.completedAt) : undefined,
        input.after ? gt(shopifyPrivacyRequest.id, input.after) : undefined
      )
    )
    .orderBy(asc(shopifyPrivacyRequest.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  return {
    requests: page.map(summarize),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  }
}

export const listShopifyPrivacyRequests: OperationUseCase<
  typeof listOperation,
  ListPrivacyInput,
  Awaited<ReturnType<typeof listRequests>>
> = {
  operation: listOperation,
  async execute({ principal, input }) {
    await authorizePrivacyOperator(principal)
    return listRequests(input)
  },
}

async function readRequest(input: { requestId: string; afterScope?: string }) {
  const [row] = await db
    .select()
    .from(shopifyPrivacyRequest)
    .where(eq(shopifyPrivacyRequest.id, input.requestId))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Privacy request not found')
  const scopes = await db
    .select({
      id: shopifyInstallationScope.id,
      ownerType: shopifyInstallationScope.ownerType,
      ownerId: shopifyInstallationScope.ownerId,
      accountId: shopifyInstallationScope.accountId,
      credentialId: shopifyInstallationScope.credentialId,
      firstSeenAt: shopifyInstallationScope.firstSeenAt,
      lastSeenAt: shopifyInstallationScope.lastSeenAt,
    })
    .from(shopifyInstallationScope)
    .where(
      and(
        eq(shopifyInstallationScope.clientId, row.clientId),
        eq(shopifyInstallationScope.shopId, row.shopId),
        input.afterScope ? gt(shopifyInstallationScope.id, input.afterScope) : undefined
      )
    )
    .orderBy(asc(shopifyInstallationScope.id))
    .limit(101)
  const page = scopes.slice(0, 100)
  return {
    request: summarize(row),
    requestPayload: row.encryptedPayload
      ? (await decryptSecret(row.encryptedPayload)).decrypted
      : null,
    review: row.encryptedEvidence
      ? (JSON.parse((await decryptSecret(row.encryptedEvidence)).decrypted) as ShopifyPrivacyReview)
      : null,
    scopes: page.map((scope) => ({
      ...scope,
      firstSeenAt: scope.firstSeenAt.toISOString(),
      lastSeenAt: scope.lastSeenAt.toISOString(),
    })),
    nextScopeCursor: scopes.length > 100 ? page[page.length - 1].id : null,
    discoveryComplete: false as const,
    requiredStores: [...SHOPIFY_PRIVACY_STORES],
    limitation:
      'Automatic discovery covers installation ownership. Customer data exports and erasure across retained data require operator fulfillment and documented evidence.',
  }
}

export const readShopifyPrivacyRequest: OperationUseCase<
  typeof readOperation,
  { requestId: string; afterScope?: string },
  Awaited<ReturnType<typeof readRequest>>
> = {
  operation: readOperation,
  async execute({ principal, input }) {
    await authorizePrivacyOperator(principal)
    return readRequest(input)
  },
}
