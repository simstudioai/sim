import { defineScimDiscoveryRoute } from '@/lib/api/server/routes/scim-route'
import { discoveryList, resourceTypes } from '@/ee/scim/protocol/discovery'

export const GET = defineScimDiscoveryRoute((baseUrl) => discoveryList(resourceTypes(baseUrl)))
