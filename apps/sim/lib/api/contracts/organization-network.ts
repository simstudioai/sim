import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { gatewayPublicMetadataSchema } from '@/lib/core/network/gateway-metadata'

export const organizationNetworkSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('direct') }),
  z.object({
    mode: z.literal('gateway'),
    publicIps: gatewayPublicMetadataSchema.shape.publicIps,
  }),
  z.object({ mode: z.literal('blocked') }),
  z.object({ mode: z.literal('unavailable') }),
])

export const getOrganizationNetworkContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/network',
  params: z.object({ id: organizationIdSchema }),
  response: { mode: 'json', schema: organizationNetworkSchema },
})

export type OrganizationNetwork = z.output<typeof organizationNetworkSchema>
