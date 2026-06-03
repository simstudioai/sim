import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Boundary contract for listing the organizations the current user belongs to.
 * Backs `GET /api/organizations`.
 */

export const creatorOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
})

export type CreatorOrganization = z.output<typeof creatorOrganizationSchema>

export const listCreatorOrganizationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations',
  response: {
    mode: 'json',
    schema: z.object({
      organizations: z.array(creatorOrganizationSchema),
      isMemberOfAnyOrg: z.boolean(),
    }),
  },
})
