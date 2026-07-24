import { z } from 'zod'
import { workflowIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const workflowAnnotationSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  blockId: z.string(),
  content: z.string(),
  createdBy: z.string().nullable(),
  resolved: z.boolean(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type WorkflowAnnotationApi = z.output<typeof workflowAnnotationSchema>

export const workflowAnnotationParamsSchema = z.object({
  id: workflowIdSchema,
})

export const workflowAnnotationDetailParamsSchema = z.object({
  id: workflowIdSchema,
  annotationId: z.string().min(1, 'Annotation ID is required'),
})

export const createWorkflowAnnotationBodySchema = z.object({
  blockId: z.string().min(1, 'Block ID is required'),
  content: z
    .string()
    .min(1, 'Comment cannot be empty')
    .max(4000, 'Comment cannot exceed 4000 characters'),
})

export type CreateWorkflowAnnotationBody = z.input<typeof createWorkflowAnnotationBodySchema>

export const updateWorkflowAnnotationBodySchema = z
  .object({
    content: z
      .string()
      .min(1, 'Comment cannot be empty')
      .max(4000, 'Comment cannot exceed 4000 characters')
      .optional(),
    resolved: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.content === undefined && value.resolved === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Provide content or resolved to update',
      })
    }
  })

export type UpdateWorkflowAnnotationBody = z.input<typeof updateWorkflowAnnotationBodySchema>

export const listWorkflowAnnotationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/annotations',
  params: workflowAnnotationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      annotations: z.array(workflowAnnotationSchema),
    }),
  },
})

export const createWorkflowAnnotationContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/annotations',
  params: workflowAnnotationParamsSchema,
  body: createWorkflowAnnotationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      annotation: workflowAnnotationSchema,
    }),
  },
})

export const updateWorkflowAnnotationContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workflows/[id]/annotations/[annotationId]',
  params: workflowAnnotationDetailParamsSchema,
  body: updateWorkflowAnnotationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      annotation: workflowAnnotationSchema,
    }),
  },
})

export const deleteWorkflowAnnotationContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workflows/[id]/annotations/[annotationId]',
  params: workflowAnnotationDetailParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})
