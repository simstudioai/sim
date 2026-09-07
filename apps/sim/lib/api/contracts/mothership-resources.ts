import { z } from 'zod'
import { requiredFieldSchema } from '@/lib/api/contracts/primitives'
import { type MothershipResource, PERSISTED_RESOURCE_TYPES } from '@/lib/mothership/resources/types'

/** Keep the complete panel address through request parsing, persistence and hydration. */
export const mothershipResourceSchema = z.object({
  type: z.enum(PERSISTED_RESOURCE_TYPES),
  id: requiredFieldSchema('resource.id cannot be empty'),
  title: z.string(),
  path: z.string().optional(),
  viewId: z.string().min(1).optional(),
  executionId: z.string().optional(),
}).superRefine((resource, ctx) => {
  if (resource.viewId === undefined || resource.type === 'table') return
  ctx.addIssue({ code: 'custom', path: ['viewId'], message: 'viewId is only valid for table resources' })
}) satisfies z.ZodType<MothershipResource>
