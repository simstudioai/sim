import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Boundary contracts for `/api/organizations`: listing the teams the current user administers,
 * and founding or recovering the team their Team or Enterprise plan pays for.
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

/** An absent body names the team after its owner, as an empty object does. */
export const createOrganizationContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations',
  body: z
    .object({
      name: z.string().optional(),
      slug: z.string().optional(),
    })
    .passthrough()
    .optional(),
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      organizationId: z.string(),
      created: z.boolean(),
    }),
  },
})
