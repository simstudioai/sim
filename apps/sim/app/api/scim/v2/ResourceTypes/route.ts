import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { resourceTypes } from '@/ee/scim/lib/protocol/discovery'
import { toListResponse } from '@/ee/scim/lib/protocol/resources'

export const GET = defineScimDiscoveryRoute((baseUrl) =>
  toListResponse(resourceTypes(baseUrl), resourceTypes(baseUrl).length, 1)
)
