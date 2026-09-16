import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { schemaDefinitions } from '@/ee/scim/lib/protocol/discovery'
import { toListResponse } from '@/ee/scim/lib/protocol/resources'

export const GET = defineScimDiscoveryRoute((baseUrl) =>
  toListResponse(schemaDefinitions(baseUrl), schemaDefinitions(baseUrl).length, 1)
)
