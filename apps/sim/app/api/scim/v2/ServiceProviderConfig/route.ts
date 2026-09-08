import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { serviceProviderConfig } from '@/ee/scim/lib/protocol/discovery'

/** Unauthenticated by design: a provider negotiates before it holds a credential. */
export const GET = defineScimDiscoveryRoute((baseUrl) => serviceProviderConfig(baseUrl))
