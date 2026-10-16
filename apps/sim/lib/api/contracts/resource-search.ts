import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** The resource families a name search covers, by their resource-tab type. */
export const RESOURCE_SEARCH_TYPES = ['workflow', 'table', 'file', 'knowledgebase', 'test'] as const

export type ResourceSearchType = (typeof RESOURCE_SEARCH_TYPES)[number]

const RESOURCE_SEARCH_MAX_RESULTS = 100

const resourceSearchItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(RESOURCE_SEARCH_TYPES),
  workspaceId: z.string(),
  workspaceName: z.string(),
})

export type ResourceSearchItem = z.output<typeof resourceSearchItemSchema>

/** A filter list: one value arrives as a scalar, several as repeated keys. */
function repeatedQuerySchema<T extends z.ZodType<string>>(item: T, max: number) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .pipe(z.array(item).max(max))
    .optional()
}

export const searchOrganizationResourcesContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/resources/search',
  params: z.object({ id: organizationIdSchema }),
  query: z.object({
    q: z
      .string()
      .trim()
      .max(200, 'q must be at most 200 characters')
      .optional()
      .transform((value) => value || undefined),
    types: repeatedQuerySchema(z.enum(RESOURCE_SEARCH_TYPES), RESOURCE_SEARCH_TYPES.length),
    workspaceIds: repeatedQuerySchema(z.string().min(1), 200),
    limit: z.coerce.number().int().min(1).max(RESOURCE_SEARCH_MAX_RESULTS).default(50),
    cursor: z.string().min(1, 'cursor must be a non-empty token').max(2048).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      items: z.array(resourceSearchItemSchema).max(RESOURCE_SEARCH_MAX_RESULTS),
      nextCursor: z.string().nullable(),
    }),
  },
})
