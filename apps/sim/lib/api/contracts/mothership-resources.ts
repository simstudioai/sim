import { z } from 'zod'
import { requiredFieldSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { predicateInputSchema, sortSpecSchema } from '@/lib/api/contracts/tables'
import { ResourceAddress, SearchResource } from '@/lib/mothership/generated/resources'
import {
  type MothershipResource,
  MothershipResourceType,
  PERSISTED_RESOURCE_TYPES,
} from '@/lib/mothership/resources/types'

/** Keep the complete panel address through request parsing, persistence and hydration. */
const resourceAddressSchema = z
  .object({
    type: z.enum(PERSISTED_RESOURCE_TYPES),
    id: requiredFieldSchema('resource.id cannot be empty'),
    workspaceId: workspaceIdSchema.optional(),
    workspaceName: z.string().max(256).optional(),
    path: z.string().optional(),
    viewId: z.string().min(1).optional(),
    executionId: z.string().optional(),
    search: SearchResource.optional(),
    sources: ResourceAddress.shape.sources,
  })
  .superRefine((resource, ctx) => {
    if ((resource.type === 'sources') !== (resource.sources !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Source message is required only for sources resources',
      })
    if ((resource.type === 'search') !== (resource.search !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['search'],
        message: 'Search metadata is required only for search resources',
      })
    if (
      resource.search &&
      resource.workspaceId !==
        (resource.search.scope.kind === 'workspace' ? resource.search.scope.workspaceId : undefined)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['workspaceId'],
        message: 'Search scope must match its resource owner',
      })
    if (resource.viewId === undefined || resource.type === 'table') return
    ctx.addIssue({
      code: 'custom',
      path: ['viewId'],
      message: 'viewId is only valid for table resources',
    })
  })

export const mothershipResourceSchema = resourceAddressSchema.safeExtend({
  title: z.string(),
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
export const mothershipResourceAttachmentSchema = resourceAddressSchema.safeExtend({
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
