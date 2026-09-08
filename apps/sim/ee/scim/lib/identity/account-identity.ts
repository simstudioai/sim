import { user } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { assertEmailAvailable } from '@/ee/scim/lib/identity/resolve-user'

/**
 * Writes the directory's view of who a person is onto their Sim account.
 *
 * Shared by an attribute update and by relinking a recreated identity, so a
 * rename that arrives as delete-and-recreate lands the same way as one that
 * arrives as a PATCH. The caller has already proven the organization owns the
 * new address's domain; this asserts nobody else holds it and applies it.
 */
export async function syncAccountIdentityTx(
  tx: DbOrTx,
  params: { userId: string; email?: string; name: string }
): Promise<void> {
  let emailChanged = false
  if (params.email !== undefined) {
    const [current] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, params.userId))
      .limit(1)
    emailChanged = normalizeEmail(current?.email ?? '') !== normalizeEmail(params.email)
    if (emailChanged) await assertEmailAvailable(tx, params.email, params.userId)
  }
  await tx
    .update(user)
    .set({
      name: params.name,
      ...(params.email !== undefined && emailChanged
        ? {
            email: params.email,
            normalizedEmail: normalizeEmail(params.email),
            emailVerified: false,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(user.id, params.userId))
}
