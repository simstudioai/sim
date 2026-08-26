import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { credentialProviderMatchesService, getServiceConfigByServiceId } from '@/lib/oauth/utils'

/** Checks selector credential/provider binding without loading token plaintext. */
export async function selectorCredentialMatchesService(input: {
  credentialId: string
  credentialOwnerUserId: string
  serviceId: string
}): Promise<boolean> {
  const [credentialRow] = await db
    .select({ accountId: credential.accountId, providerId: credential.providerId })
    .from(credential)
    .where(eq(credential.id, input.credentialId))
    .limit(1)

  let providerId = credentialRow?.providerId ?? null
  const accountId = credentialRow?.accountId ?? input.credentialId
  if (!providerId) {
    const [accountRow] = await db
      .select({ providerId: account.providerId })
      .from(account)
      .where(and(eq(account.id, accountId), eq(account.userId, input.credentialOwnerUserId)))
      .limit(1)
    providerId = accountRow?.providerId ?? null
  }

  const service = getServiceConfigByServiceId(input.serviceId)
  return Boolean(providerId && service && credentialProviderMatchesService(providerId, service))
}
