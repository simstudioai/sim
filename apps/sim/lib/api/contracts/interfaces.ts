import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { INTERFACE_IDENTIFIER_PATTERN } from '@/lib/interfaces'

/** Matches InterfaceSpec theme colors (#RGB/#RRGGBB(/AA) or CSS var tokens). */
const INTERFACE_COLOR_PATTERN = /^(#[0-9A-Fa-f]{3,8}|var\(--[a-zA-Z0-9-]+\))$/

export const interfaceIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const interfaceIdentifierParamsSchema = z.object({
  identifier: z.string().min(1),
})

export const interfaceOutputConfigSchema = z.object({
  blockId: z.string().min(1),
  path: z.string().min(1),
})

export const interfaceCustomizationsSchema = z.object({
  primaryColor: z.string().regex(INTERFACE_COLOR_PATTERN).optional(),
  brief: z.string().max(2000).optional(),
})

export const createInterfaceBodySchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(
      INTERFACE_IDENTIFIER_PATTERN,
      'Identifier can only contain lowercase letters, numbers, and hyphens'
    )
    .max(100),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(1000).optional(),
  customizations: interfaceCustomizationsSchema.optional(),
  authType: z.literal('public').default('public'),
  outputConfigs: z.array(interfaceOutputConfigSchema).optional().default([]),
  spec: z.unknown(),
  versionDescription: z.string().optional(),
  versionName: z.string().optional(),
})
export type CreateInterfaceBody = z.input<typeof createInterfaceBodySchema>

export const updateInterfaceBodySchema = z.object({
  identifier: z.string().min(1).regex(INTERFACE_IDENTIFIER_PATTERN).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  customizations: interfaceCustomizationsSchema.optional(),
  authType: z.literal('public').optional(),
  outputConfigs: z.array(interfaceOutputConfigSchema).optional(),
  spec: z.unknown().optional(),
  versionDescription: z.string().optional(),
  versionName: z.string().optional(),
})
export type UpdateInterfaceBody = z.input<typeof updateInterfaceBodySchema>

export const createInterfaceResponseSchema = z.object({
  id: z.string(),
  interfaceId: z.string(),
  interfaceUrl: z.string(),
  message: z.string(),
})

export const updateInterfaceResponseSchema = z.object({
  id: z.string(),
  interfaceUrl: z.string(),
  message: z.string(),
})

export const deleteInterfaceResponseSchema = z.object({
  message: z.string(),
})

export const generateInterfaceBodySchema = z.object({
  workflowId: z.string().min(1),
  brief: z.string().max(2000).optional(),
  primaryColor: z.string().regex(INTERFACE_COLOR_PATTERN).optional(),
  title: z.string().max(200).optional(),
})

export const generateInterfaceResponseSchema = z.object({
  spec: z.unknown(),
})

export const interfaceExecuteBodySchema = z.object({
  actionId: z.string().min(1).max(64),
  values: z.record(z.string(), z.unknown()).default({}),
})

export const interfaceExecuteResponseSchema = z.object({
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
})

export const interfaceIdentifierValidationQuerySchema = z.object({
  identifier: z.string().min(1).regex(INTERFACE_IDENTIFIER_PATTERN).max(100),
})

export const createInterfaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces',
  body: createInterfaceBodySchema,
  response: { mode: 'json', schema: createInterfaceResponseSchema },
})

export const updateInterfaceContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/interfaces/manage/[id]',
  params: interfaceIdParamsSchema,
  body: updateInterfaceBodySchema,
  response: { mode: 'json', schema: updateInterfaceResponseSchema },
})

export const deleteInterfaceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/interfaces/manage/[id]',
  params: interfaceIdParamsSchema,
  response: { mode: 'json', schema: deleteInterfaceResponseSchema },
})

export const generateInterfaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces/generate',
  body: generateInterfaceBodySchema,
  response: { mode: 'json', schema: generateInterfaceResponseSchema },
})

const publicInterfaceControlSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['text', 'textarea', 'number', 'checkbox']),
    id: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({
    type: z.literal('select'),
    id: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    options: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      })
    ),
  }),
  z.object({
    type: z.literal('markdown'),
    id: z.string(),
    content: z.string(),
  }),
])

export const publicInterfaceDtoSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  primaryColor: z.string().regex(INTERFACE_COLOR_PATTERN),
  density: z.enum(['comfortable', 'compact']).optional(),
  pageDescription: z.string().optional(),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      controls: z.array(publicInterfaceControlSchema),
    })
  ),
  actions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      variant: z.enum(['primary', 'secondary']),
    })
  ),
  messages: z
    .object({
      success: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  auth: z.object({ type: z.literal('public') }),
})

export const getPublicInterfaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/interfaces/[identifier]',
  params: interfaceIdentifierParamsSchema,
  response: {
    mode: 'json',
    schema: publicInterfaceDtoSchema,
  },
})

export const executePublicInterfaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces/[identifier]',
  params: interfaceIdentifierParamsSchema,
  body: interfaceExecuteBodySchema,
  response: { mode: 'json', schema: interfaceExecuteResponseSchema },
})

export const validateInterfaceIdentifierContract = defineRouteContract({
  method: 'GET',
  path: '/api/interfaces/validate',
  query: interfaceIdentifierValidationQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      available: z.boolean(),
      error: z.string().nullable().optional(),
    }),
  },
})

export const interfaceDeploymentStatusSchema = z.object({
  isDeployed: z.boolean(),
  deployment: z
    .object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      description: z.string().nullable().optional(),
      customizations: interfaceCustomizationsSchema.nullable().optional(),
      authType: z.string().optional(),
      outputConfigs: z.array(interfaceOutputConfigSchema).nullable().optional(),
      spec: z.unknown().optional(),
    })
    .nullable(),
})

export const getInterfaceDeploymentStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/interface/status',
  params: z.object({ id: z.string().min(1) }),
  response: {
    mode: 'json',
    schema: interfaceDeploymentStatusSchema,
  },
})

export const validateInterfaceIdentifierResponseSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable().optional(),
})
