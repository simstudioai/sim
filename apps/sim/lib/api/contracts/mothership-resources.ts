import { z } from 'zod'
import { requiredFieldSchema } from '@/lib/api/contracts/primitives'
import { predicateInputSchema, sortSpecSchema } from '@/lib/api/contracts/tables'
import {
  type MothershipResource,
  MothershipResourceType,
  PERSISTED_RESOURCE_TYPES,
} from '@/lib/mothership/resources/types'

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

/** The query visible in an embedded table, including changes not saved yet. */
export const mothershipTableViewContextSchema = z
  .object({
    viewId: z.string().min(1).nullable(),
    filter: predicateInputSchema.nullable(),
    sort: sortSpecSchema.nullable(),
  })
  .strict()

export type MothershipTableViewContext = z.infer<typeof mothershipTableViewContextSchema>

/** Open panels carry their saved address plus current client-held view state. */
export const mothershipResourceAttachmentSchema = mothershipResourceSchema.extend({
  type: z.enum(Object.values(MothershipResourceType)),
  title: z.string().optional(),
  active: z.boolean().optional(),
  currentView: mothershipTableViewContextSchema.optional(),
  url: z
    .string()
    .max(2048)
    .regex(/^https?:\/\//, 'Must be an http(s) URL')
    .optional(),
})

export type MothershipResourceAttachment = z.infer<typeof mothershipResourceAttachmentSchema>
