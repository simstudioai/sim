import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'

const memorySpaceParamsSchema = z.object({ id: organizationIdSchema })
const createMemorySpaceBodySchema = z.object({ name: z.string().trim().min(1).max(100) }).strict()
const selectMemorySpaceBodySchema = z.object({ spaceId: z.uuid().nullable() }).strict()
const memorySpaceSelectionSchema = z.object({ activeSpaceId: z.uuid().nullable() })
const memorySpaceListSchema = memorySpaceSelectionSchema.extend({
  spaces: z.array(z.object({ id: z.uuid().nullable(), name: z.string() })),
})
export type CreateMemorySpaceBody = z.input<typeof createMemorySpaceBodySchema>
export type SelectMemorySpaceBody = z.input<typeof selectMemorySpaceBodySchema>

export const listMemorySpacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/memory-spaces',
  params: memorySpaceParamsSchema,
  response: { mode: 'json', schema: memorySpaceListSchema },
})
export const createMemorySpaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/memory-spaces',
  params: memorySpaceParamsSchema,
  body: createMemorySpaceBodySchema,
  response: { mode: 'json', schema: memorySpaceSelectionSchema },
})
export const selectMemorySpaceContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/memory-spaces/active',
  params: memorySpaceParamsSchema,
  body: selectMemorySpaceBodySchema,
  response: { mode: 'json', schema: memorySpaceSelectionSchema },
})
