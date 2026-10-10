import { db } from '@sim/db'
import { account, credential, credentialMember, shopifyInstallationAttempt } from '@sim/db/schema'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { and, desc, eq, gt } from 'drizzle-orm'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import type { DbOrTx } from '@/lib/db/types'
import {
  hashShopifyBrowserProof,
  SHOPIFY_INSTALL_TTL_MS,
} from '@/lib/oauth/shopify-install-protocol'
import {
  acquireShopifyInstallationTokens,
  lockShopifyInstallation,
} from '@/lib/oauth/shopify-installation'
import { rememberShopifyInstallationScope } from '@/lib/shopify/privacy/installation-scopes'

function unavailable(): never {
  throw new OrchestrationError(
    'not_found',
    'This Shopify connection link is invalid or expired. Open Sim from Shopify to try again.'
  )
}

async function loadAttempt(
  executor: DbOrTx,
  attemptId: string,
  browserProof: string,
  forUpdate = false
) {
  const { values } = requireConfiguredOAuthClient('shopify')
  const query = executor
    .select()
    .from(shopifyInstallationAttempt)
    .where(
      and(
        eq(shopifyInstallationAttempt.id, attemptId),
        eq(shopifyInstallationAttempt.clientId, values.SHOPIFY_CLIENT_ID),
        gt(shopifyInstallationAttempt.expiresAt, new Date())
      )
    )
    .limit(1)
  const [attempt] = forUpdate ? await query.for('update') : await query
  if (
    !attempt ||
    !browserProof ||
    browserProof.length < 16 ||
    browserProof.length > 128 ||
    !safeCompare(attempt.browserHash, hashShopifyBrowserProof(browserProof))
  )
    unavailable()
  return attempt
}

/** Starts a bounded anonymous OAuth protocol; no human or workspace authority is inferred. */
export async function createShopifyInstallAttempt(
  shopDomain: string,
  browserProof: string
): Promise<string> {
  const { values } = requireConfiguredOAuthClient('shopify')
  const browserHash = hashShopifyBrowserProof(browserProof)
  return db.transaction(async (tx) => {
    await lockShopifyInstallation(tx, shopDomain)
    const active = await tx
      .select({ id: shopifyInstallationAttempt.id })
      .from(shopifyInstallationAttempt)
      .where(
        and(
          eq(shopifyInstallationAttempt.clientId, values.SHOPIFY_CLIENT_ID),
          eq(shopifyInstallationAttempt.shopDomain, shopDomain),
          gt(shopifyInstallationAttempt.expiresAt, new Date())
        )
      )
      .limit(100)
    if (active.length >= 100)
      throw new OrchestrationError(
        'conflict',
        'Too many pending Shopify connections. Try again in 15 minutes.'
      )
    const id = generateId()
    await tx.insert(shopifyInstallationAttempt).values({
      id,
      clientId: values.SHOPIFY_CLIENT_ID,
      shopDomain,
      browserHash,
      expiresAt: new Date(Date.now() + SHOPIFY_INSTALL_TTL_MS),
    })
    return id
  })
}

/** Completes Shopify OAuth before Sim login, persisting the rotating chain without a fake user. */
export async function completeShopifyInstallHandoff(params: {
  attemptId: string
  browserProof: string
  shopDomain: string
  code: string
  signal?: AbortSignal
}): Promise<void> {
  params.signal?.throwIfAborted()
  await db.transaction(async (tx) => {
    await lockShopifyInstallation(tx, params.shopDomain)
    const attempt = await loadAttempt(tx, params.attemptId, params.browserProof, true)
    if (
      attempt.shopDomain !== params.shopDomain ||
      attempt.shopId ||
      attempt.encryptedTokens ||
      attempt.claimedByUserId
    )
      unavailable()
    const { shopId, chain } = await acquireShopifyInstallationTokens(tx, params)
    const { encrypted } = await encryptSecret(
      JSON.stringify({ accessToken: chain.accessToken, refreshToken: chain.refreshToken })
    )
    await tx
      .update(shopifyInstallationAttempt)
      .set({
        shopId,
        encryptedTokens: encrypted,
        scope: chain.scope,
        accessTokenExpiresAt: chain.accessTokenExpiresAt,
        refreshTokenExpiresAt: chain.refreshTokenExpiresAt,
        expiresAt: new Date(Date.now() + SHOPIFY_INSTALL_TTL_MS),
        updatedAt: new Date(),
      })
      .where(eq(shopifyInstallationAttempt.id, attempt.id))
  })
}

/** Projects only the shop label for a browser that proved ownership of a completed OAuth handoff. */
export async function getShopifyInstallHandoff(
  attemptId: string,
  browserProof: string
): Promise<{ shopDomain: string }> {
  const attempt = await loadAttempt(db, attemptId, browserProof)
  if (!attempt.shopId || !attempt.encryptedTokens || attempt.claimedByUserId) unavailable()
  return { shopDomain: attempt.shopDomain }
}

/** Atomically attaches an already-authorized shop to the application's canonical workspace target. */
export async function claimShopifyInstall(params: {
  attemptId: string
  browserProof: string
  userId: string
  workspaceId: string
  displayName?: string
}) {
  const initial = await loadAttempt(db, params.attemptId, params.browserProof)
  return db.transaction(async (tx) => {
    await lockShopifyInstallation(tx, initial.shopDomain)
    const attempt = await loadAttempt(tx, params.attemptId, params.browserProof, true)
    if (attempt.claimedByUserId) {
      if (
        attempt.claimedByUserId !== params.userId ||
        attempt.workspaceId !== params.workspaceId ||
        !attempt.credentialId
      )
        unavailable()
      const [existing] = await tx
        .select({
          id: credential.id,
          displayName: credential.displayName,
          accountId: credential.accountId,
        })
        .from(credential)
        .where(
          and(
            eq(credential.id, attempt.credentialId),
            eq(credential.workspaceId, params.workspaceId)
          )
        )
        .limit(1)
      if (!existing?.accountId) unavailable()
      return {
        credentialId: existing.id,
        accountId: existing.accountId,
        displayName: existing.displayName,
        workspaceId: params.workspaceId,
        created: false,
        changed: false,
        shopDomain: attempt.shopDomain,
      }
    }
    if (
      !attempt.shopId ||
      !attempt.encryptedTokens ||
      !attempt.accessTokenExpiresAt ||
      !attempt.refreshTokenExpiresAt
    )
      unavailable()
    const [latest] = await tx
      .select()
      .from(account)
      .where(and(eq(account.providerId, 'shopify'), eq(account.accountId, attempt.shopId)))
      .orderBy(desc(account.updatedAt))
      .limit(1)
    const { decrypted } = await decryptSecret(attempt.encryptedTokens, { logFailure: false })
    const tokens = toRecord(JSON.parse(decrypted))
    const accessToken = latest?.accessToken ?? tokens.accessToken
    const refreshToken = latest?.refreshToken ?? tokens.refreshToken
    const accessTokenExpiresAt = latest?.accessTokenExpiresAt ?? attempt.accessTokenExpiresAt
    const refreshTokenExpiresAt = latest?.refreshTokenExpiresAt ?? attempt.refreshTokenExpiresAt
    if (
      typeof accessToken !== 'string' ||
      typeof refreshToken !== 'string' ||
      accessTokenExpiresAt.getTime() <= Date.now() ||
      refreshTokenExpiresAt.getTime() <= Date.now()
    )
      unavailable()
    const [existingAccount] = await tx
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.providerId, 'shopify'),
          eq(account.accountId, attempt.shopId),
          eq(account.userId, params.userId)
        )
      )
      .limit(1)
    const accountId = existingAccount?.id ?? generateId()
    const now = new Date()
    const data = {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      scope: latest?.scope ?? attempt.scope,
      idToken: attempt.shopDomain,
      updatedAt: now,
    }
    if (existingAccount) await tx.update(account).set(data).where(eq(account.id, accountId))
    else
      await tx.insert(account).values({
        id: accountId,
        providerId: 'shopify',
        accountId: attempt.shopId,
        userId: params.userId,
        ...data,
        createdAt: now,
      })
    const [existingCredential] = await tx
      .select({ id: credential.id, displayName: credential.displayName })
      .from(credential)
      .where(
        and(eq(credential.workspaceId, params.workspaceId), eq(credential.accountId, accountId))
      )
      .limit(1)
    const credentialId = existingCredential?.id ?? generateId()
    const displayName =
      existingCredential?.displayName ?? params.displayName?.trim() ?? attempt.shopDomain
    if (existingCredential)
      await tx.update(credential).set({ updatedAt: now }).where(eq(credential.id, credentialId))
    else {
      await tx.insert(credential).values({
        id: credentialId,
        workspaceId: params.workspaceId,
        type: 'oauth',
        providerId: 'shopify',
        accountId,
        displayName,
        createdBy: params.userId,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(credentialMember).values({
        id: generateId(),
        credentialId,
        userId: params.userId,
        role: 'admin',
        status: 'active',
        invitedBy: params.userId,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
    await rememberShopifyInstallationScope(
      {
        appClientId: attempt.clientId,
        shopId: attempt.shopId,
        shopDomain: attempt.shopDomain,
        accountId,
        credentialId,
        workspaceId: params.workspaceId,
      },
      tx
    )
    await tx
      .update(shopifyInstallationAttempt)
      .set({
        claimedByUserId: params.userId,
        credentialId,
        workspaceId: params.workspaceId,
        encryptedTokens: null,
        updatedAt: now,
      })
      .where(eq(shopifyInstallationAttempt.id, attempt.id))
    return {
      credentialId,
      accountId,
      displayName,
      workspaceId: params.workspaceId,
      created: !existingCredential,
      changed: true,
      shopDomain: attempt.shopDomain,
    }
  })
}
