import { JWT } from 'google-auth-library'
import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'
import type { ParsedServiceAccount } from '@/lib/data-drains/destinations/utils'

/**
 * A service-account JWT client whose token mint leaves through `outboundFetch`, so an
 * organization with a dedicated egress gateway reaches Google's token endpoint from its own
 * static IPs. gaxios otherwise mints with its own fetch, outside the organization's route.
 */
export function createServiceAccountJwt(account: ParsedServiceAccount, scopes: string[]): JWT {
  return new JWT({
    email: account.clientEmail,
    key: account.privateKey,
    scopes,
    transporterOptions: { fetchImplementation: outboundFetch },
  })
}
