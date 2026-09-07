import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { resourceTypes } from '@/ee/scim/protocol/discovery'
import { toListResponse } from '@/ee/scim/protocol/resources'

export const GET = defineScimDiscoveryRoute((baseUrl) =>
  toListResponse(resourceTypes(baseUrl), resourceTypes(baseUrl).length, 1)
)
