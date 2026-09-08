import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '@sim/db'
import { oauthConsent, oauthTokenFamily } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import type { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { inArray } from 'drizzle-orm'
import { getOAuthIssuedResource } from '@/lib/auth/oauth-resource'
import { capabilityRefusal } from '@/lib/permission-groups/capabilities'
import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'

type BetterAuthAdapter = ReturnType<ReturnType<typeof drizzleAdapter>>
export type AuthDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
const issuedFamilyIds = new AsyncLocalStorage<Set<string>>()

interface OAuthConsentInsert {
  id?: string
  clientId: string
  userId: string | null
  referenceId: string | null
  scopes: string[]
  createdAt: Date
  updatedAt: Date
}

async function deleteTrackedFamilies(
  database: AuthDatabase,
  familyIds: Set<string>
): Promise<void> {
  if (familyIds.size === 0) return
  await database.delete(oauthTokenFamily).where(inArray(oauthTokenFamily.id, [...familyIds]))
}

/**
 * Compensates for Better Auth 1.6's non-transactional authorization-code token issuance.
 * A failed response cannot expose the refresh secret, so its newly inserted family is deleted.
 */
export async function withOAuthProviderIssuanceCompensation<T extends Response>(
  work: () => Promise<T>,
  database: AuthDatabase = db
): Promise<T> {
  const familyIds = new Set<string>()
  try {
    const response = await issuedFamilyIds.run(familyIds, work)
    if (!response.ok) await deleteTrackedFamilies(database, familyIds)
    return response
  } catch (error) {
    await deleteTrackedFamilies(database, familyIds)
    throw error
  }
}

function requireConsentInsert(data: Record<string, unknown>): OAuthConsentInsert {
  if (
    typeof data.clientId !== 'string' ||
    !Array.isArray(data.scopes) ||
    !data.scopes.every((scope) => typeof scope === 'string') ||
    !(data.createdAt instanceof Date) ||
    !(data.updatedAt instanceof Date) ||
    (data.id !== undefined && typeof data.id !== 'string') ||
    (data.userId !== undefined && data.userId !== null && typeof data.userId !== 'string') ||
    (data.referenceId !== undefined &&
      data.referenceId !== null &&
      typeof data.referenceId !== 'string')
  ) {
    throw new Error('Better Auth supplied an invalid OAuth consent record')
  }
  return {
    id: data.id,
    clientId: data.clientId,
    userId: typeof data.userId === 'string' ? data.userId : null,
    referenceId: typeof data.referenceId === 'string' ? data.referenceId : null,
    scopes: data.scopes,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }
}

/**
 * Makes the provider's read-then-create consent path atomic.
 *
 * Better Auth 1.6.27 first looks for a grant and then inserts one. Two consent
 * submissions can therefore race. The database uniqueness constraint is the
 * integrity backstop; this adapter seam turns the losing insert into the same
 * scope update the provider would have made had its preceding read seen the
 * row, and returns the real persisted record expected by the adapter contract.
 */
export function guardOAuthProviderWrites(
  adapter: BetterAuthAdapter,
  database: AuthDatabase = db
): BetterAuthAdapter {
  return {
    ...adapter,
    create: async (input) => {
      /**
       * permission-group-enforced: oauth_apps.use — recheck the canonical token
       * owner after code validation, including codes issued before a policy change.
       */
      if (input.model === 'oauthAccessToken' || input.model === 'oauthRefreshToken') {
        const userId = input.data.userId
        if (typeof userId !== 'string' || !userId) {
          throw new APIError('BAD_REQUEST', {
            error: 'invalid_grant',
            error_description: 'OAuth tokens require a user.',
          })
        }
        if (await isCapabilityWithheldForUser(userId, 'oauth_apps.use')) {
          throw new APIError('BAD_REQUEST', {
            error: 'invalid_grant',
            error_description: capabilityRefusal('oauth_apps.use'),
          })
        }
        const scopes = Array.isArray(input.data.scopes) ? input.data.scopes : []
        input = {
          ...input,
          data: { ...input.data, resource: getOAuthIssuedResource(scopes) },
        }
      }

      if (input.model !== 'oauthConsent') {
        const created = await adapter.create(input)
        if (input.model === 'oauthRefreshToken') {
          const id = (created as { id?: unknown }).id
          if (typeof id !== 'string' || !id) {
            throw new Error('OAuth refresh-token insert returned no family id')
          }
          issuedFamilyIds.getStore()?.add(id)
        }
        return created as never
      }

      const values = requireConsentInsert(input.data)
      const [consent] = await database
        .insert(oauthConsent)
        .values({
          id: input.forceAllowId && values.id ? values.id : generateId(),
          clientId: values.clientId,
          userId: values.userId ?? null,
          referenceId: values.referenceId ?? null,
          scopes: values.scopes,
          createdAt: values.createdAt,
          updatedAt: values.updatedAt,
        })
        .onConflictDoUpdate({
          target: [oauthConsent.userId, oauthConsent.clientId, oauthConsent.referenceId],
          set: {
            scopes: values.scopes,
            updatedAt: values.updatedAt,
          },
        })
        .returning()

      if (!consent) throw new Error('OAuth consent upsert returned no row')
      if (!input.select?.length) return consent as never
      return Object.fromEntries(
        input.select.map((field) => [field, consent[field as keyof typeof consent]])
      ) as never
    },
  }
}
