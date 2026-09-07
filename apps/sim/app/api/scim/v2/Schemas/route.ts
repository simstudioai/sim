import { defineScimDiscoveryRoute } from '@/lib/api/server/routes/scim-route'
import { discoveryList, schemaDefinitions } from '@/ee/scim/protocol/discovery'

export const GET = defineScimDiscoveryRoute((baseUrl) => discoveryList(schemaDefinitions(baseUrl)))
