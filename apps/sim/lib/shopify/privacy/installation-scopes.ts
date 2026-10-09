import { db } from '@sim/db'
import { account, credential, shopifyInstallationScope } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt } from 'drizzle-orm'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import type { DbOrTx } from '@/lib/db/types'

interface RememberInstallationScopeInput {
  appClientId: string
  shopId: string
  shopDomain: string
  accountId: string
  credentialId: string
  workspaceId?: string | null
  organizationId?: string | null
}

/** Retains verified installation ownership independently of account and credential lifetimes. */
export async function rememberShopifyInstallationScope(
  input: RememberInstallationScopeInput,
  executor: DbOrTx = db
): Promise<void> {
  const ownerId = input.organizationId || input.workspaceId
  if (!ownerId || Boolean(input.organizationId) === Boolean(input.workspaceId)) {
    throw new Error('Shopify installation history requires one canonical owner')
  }
  if (
    !/^[1-9]\d{0,19}$/.test(input.shopId) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(input.shopDomain)
  ) {
    throw new Error('Shopify installation history requires a verified shop identity')
  }
  await executor
    .insert(shopifyInstallationScope)
    .values({
      id: generateId(),
      clientId: input.appClientId,
      shopId: input.shopId,
      shopDomain: input.shopDomain,
      ownerType: input.organizationId ? 'organization' : 'workspace',
      ownerId,
      accountId: input.accountId,
      credentialId: input.credentialId,
    })
    .onConflictDoUpdate({
      target: [
        shopifyInstallationScope.clientId,
        shopifyInstallationScope.shopId,
        shopifyInstallationScope.ownerType,
        shopifyInstallationScope.ownerId,
        shopifyInstallationScope.credentialId,
      ],
      set: { shopDomain: input.shopDomain, accountId: input.accountId, lastSeenAt: new Date() },
    })
}

/** Captures existing OAuth associations after the legacy credential draft has completed. */
export async function rememberShopifyAccountScopes(accountId: string): Promise<void> {
  const [installation] = await db
    .select({
      shopId: account.accountId,
      shopDomain: account.idToken,
    })
    .from(account)
    .where(and(eq(account.id, accountId), eq(account.providerId, 'shopify')))
    .limit(1)
  if (!installation?.shopDomain) return
  const { values } = requireConfiguredOAuthClient('shopify')
  let cursor: string | undefined
  while (true) {
    const associations = await db
      .select({
        credentialId: credential.id,
        workspaceId: credential.workspaceId,
        organizationId: credential.organizationId,
      })
      .from(credential)
      .where(
        and(
          eq(credential.accountId, accountId),
          eq(credential.type, 'oauth'),
          cursor ? gt(credential.id, cursor) : undefined
        )
      )
      .orderBy(asc(credential.id))
      .limit(100)
    for (const association of associations) {
      await rememberShopifyInstallationScope({
        ...association,
        appClientId: values.SHOPIFY_CLIENT_ID,
        shopId: installation.shopId,
        shopDomain: installation.shopDomain.toLowerCase(),
        accountId,
      })
    }
    if (associations.length < 100) return
    cursor = associations[associations.length - 1].credentialId
  }
}
