import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { schemaDefinitions } from '@/ee/scim/protocol/discovery'
import { toListResponse } from '@/ee/scim/protocol/resources'

export const GET = defineScimDiscoveryRoute((baseUrl) =>
  toListResponse(schemaDefinitions(baseUrl), schemaDefinitions(baseUrl).length, 1)
)
