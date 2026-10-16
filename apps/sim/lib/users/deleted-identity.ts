import { db } from '@sim/db'
import { account, deletedAccountIdentity, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { hmacSha256Hex } from '@sim/security/hmac'
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { isSignInProviderAllowed, SIGN_IN_PROVIDER_IDS } from '@/lib/auth/constants'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Free-tier abuse guard for self-service account deletion.
 *
 * The free allowance is a one-time grant per person, but deletion erases the
 * account row and the usage ledger with it, so without this a person could
 * delete and re-register the same Google, GitHub, or email identity for a fresh
 * allowance each time. Deletion keeps only keyed one-way digests of the
 * account's sign-in identities; a new account on a matching identity is created
 * normally but without the free allowance. This is the "one free trial per
 * identity" pattern, kept to data minimisation: no user id, address, or
 * profile data survives, the digest is useless without the server key, and
 * every row expires after {@link DELETED_IDENTITY_RETENTION_MS}.
 *
 * Only meaningful where billing is enabled; self-hosted deployments keep nothing.
 */

const logger = createLogger('DeletedAccountIdentity')

/** How long a deleted identity withholds the free allowance from new accounts. */
const DELETED_IDENTITY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

/** Expired rows removed per recorded deletion, which keeps the table bounded without a cron. */
const EXPIRED_PURGE_BATCH = 100

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * Providers whose documented sub-addressing delivers `name+tag@` to `name@`.
 * Plus-addressing is a provider feature, not an email standard: elsewhere the
 * two can be different mailboxes, so tags are only stripped where it holds.
 */
const PLUS_ADDRESSING_DOMAINS = new Set([
  ...GMAIL_DOMAINS,
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'fastmail.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
])

/**
 * One social sign-in identity: the provider and that provider's stable subject
 * id. Only `SIGN_IN_PROVIDER_IDS` count; integration connections share the
 * `account` table but carry per-connection ids, and the email/password row's
 * `accountId` is the user id itself.
 */
interface OAuthSubject {
  providerId: string
  accountId: string
}

interface SignInIdentity {
  email?: string | null
  oauthSubjects?: OAuthSubject[]
}

let identityKey: string | undefined

/** Purpose-bound key, so a digest here can never be replayed against any other use of the secret. */
function getIdentityKey(): string {
  identityKey ??= hmacSha256Hex('sim:deleted-account-identity:v1', env.BETTER_AUTH_SECRET)
  return identityKey
}

/**
 * Collapses the address variants that deliver to the same mailbox: case, `+tag`
 * sub-addressing at providers that support it, and Gmail's ignored dots and
 * `googlemail.com` alias.
 */
function canonicalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0 || at === normalized.length - 1) return null
  let local = normalized.slice(0, at)
  let domain = normalized.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0 && PLUS_ADDRESSING_DOMAINS.has(domain)) local = local.slice(0, plus)
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '')
    domain = 'gmail.com'
  }
  return local ? `${local}@${domain}` : null
}

function identityHashes(identity: SignInIdentity): string[] {
  const preimages: string[] = []
  const email = identity.email ? canonicalizeEmail(identity.email) : null
  if (email) preimages.push(`email:${email}`)
  for (const subject of identity.oauthSubjects ?? []) {
    if (!isSignInProviderAllowed(subject.providerId) || !subject.accountId) continue
    preimages.push(`oauth:${subject.providerId}:${subject.accountId}`)
  }
  const key = getIdentityKey()
  return [...new Set(preimages)].map((preimage) => hmacSha256Hex(preimage, key))
}

/**
 * Records the sign-in identities of an account being deleted at its holder's
 * request. Runs inside the deletion transaction, before the `user` row and its
 * `account` rows cascade away, so the record and the erasure commit together.
 */
export async function recordDeletedAccountIdentities(tx: DbOrTx, userId: string): Promise<void> {
  if (!isBillingEnabled) return

  const [profile] = await tx
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const oauthSubjects = await tx
    .select({ providerId: account.providerId, accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), inArray(account.providerId, [...SIGN_IN_PROVIDER_IDS])))

  const hashes = identityHashes({ email: profile?.email, oauthSubjects })
  if (hashes.length === 0) return

  await tx
    .delete(deletedAccountIdentity)
    .where(
      inArray(
        deletedAccountIdentity.identityHash,
        tx
          .select({ identityHash: deletedAccountIdentity.identityHash })
          .from(deletedAccountIdentity)
          .where(lte(deletedAccountIdentity.expiresAt, sql`now()`))
          .limit(EXPIRED_PURGE_BATCH)
      )
    )

  const expiresAt = new Date(Date.now() + DELETED_IDENTITY_RETENTION_MS)
  await tx
    .insert(deletedAccountIdentity)
    .values(hashes.map((identityHash) => ({ identityHash, expiresAt })))
    .onConflictDoUpdate({
      target: deletedAccountIdentity.identityHash,
      set: { deletedAt: sql`now()`, expiresAt },
    })
}

/**
 * Whether any of these identities belonged to an account deleted within the
 * retention window. Fails open: a lookup error returns `false` and is logged,
 * because refusing a legitimate person's allowance is worse than one missed match.
 */
export async function isDeletedAccountIdentity(identity: SignInIdentity): Promise<boolean> {
  if (!isBillingEnabled) return false
  try {
    const hashes = identityHashes(identity)
    if (hashes.length === 0) return false
    const [match] = await db
      .select({ identityHash: deletedAccountIdentity.identityHash })
      .from(deletedAccountIdentity)
      .where(
        and(
          inArray(deletedAccountIdentity.identityHash, hashes),
          gt(deletedAccountIdentity.expiresAt, sql`now()`)
        )
      )
      .limit(1)
    return Boolean(match)
  } catch (error) {
    logger.error('Deleted-identity lookup failed; granting the free allowance', { error })
    return false
  }
}
