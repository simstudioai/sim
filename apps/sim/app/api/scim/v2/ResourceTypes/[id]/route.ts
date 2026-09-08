import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { resourceTypes } from '@/ee/scim/lib/protocol/discovery'
import { notFound } from '@/ee/scim/lib/protocol/errors'

export const GET = defineScimDiscoveryRoute((baseUrl, params) => {
  const id = typeof params.id === 'string' ? params.id : ''
  const match = resourceTypes(baseUrl).find(
    (resource) => resource.id.toLowerCase() === id.toLowerCase()
  )
  if (!match) throw notFound(`Resource type ${id} not found`)
  return match
})
