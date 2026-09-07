import { defineScimDiscoveryRoute } from '@/lib/api/server/routes/scim-route'
import { discoveryList, resourceTypes } from '@/lib/scim/protocol/discovery'

export const GET = defineScimDiscoveryRoute((baseUrl) => discoveryList(resourceTypes(baseUrl)))
