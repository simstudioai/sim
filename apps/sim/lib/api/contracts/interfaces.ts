import { z } from 'zod'
import {
  domainObjectSchema,
  successResponseSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  INTERFACE_LAYOUT_LIMITS,
  MAX_INTERFACE_DESCRIPTION_LENGTH,
  MAX_INTERFACE_NAME_LENGTH,
} from '@/lib/interfaces/constants'
import { interfaceLayoutSchema } from '@/lib/interfaces/schema'
import type { InterfaceDefinition } from '@/lib/interfaces/types'

/**
 * Boundary contracts for workspace interfaces (`/api/interfaces/**`).
 *
 * Unlike the tables family, the module layout is validated with REAL zod
 * schemas rather than a `domainObjectSchema` passthrough: the layout is
 * user-authored boundary data that the Sim agent also writes, so the schema
 * IS the validation. The layout schemas live in `@/lib/interfaces/schema` —
 * `validateLayout` runs the exact same schemas for non-HTTP writers, so the
 * boundary and the domain gate cannot drift. Only the same-workspace
 * reference checks stay behind in `@/lib/interfaces/validation`.
 */

/**
 * The persisted interface record, returned directly under `data` (never
 * nested as `data: { interface: ... }` — `interface` is a strict-mode
 * reserved word, so destructuring it is a syntax error waiting to happen).
 * The service guarantees the shape, so the response uses a typed passthrough.
 */
const interfaceDefinitionSchema = domainObjectSchema<InterfaceDefinition>()

export const interfaceScopeSchema = z.enum(['active', 'archived'])

export const interfaceIdParamsSchema = z.object({
  interfaceId: z.string().min(1, 'Interface ID is required'),
})

export const interfaceModuleParamsSchema = interfaceIdParamsSchema.extend({
  moduleId: z.string().min(1, 'Module ID is required'),
})

/**
 * Trimmed before the bounds run, so a whitespace-only name fails here with a
 * 400 rather than reaching the service's `assertValidName`, which throws an
 * untyped `Error` and would surface as a 500.
 */
const interfaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(MAX_INTERFACE_NAME_LENGTH, `Name must be ${MAX_INTERFACE_NAME_LENGTH} characters or less`)

const interfaceDescriptionSchema = z
  .string()
  .max(
    MAX_INTERFACE_DESCRIPTION_LENGTH,
    `Description must be ${MAX_INTERFACE_DESCRIPTION_LENGTH} characters or less`
  )

export const listInterfacesQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  scope: interfaceScopeSchema.default('active'),
})

export const getInterfaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export const createInterfaceBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  name: interfaceNameSchema,
  description: interfaceDescriptionSchema.optional(),
})

/**
 * Optimistic-concurrency precondition: the `updatedAt` the caller believes it
 * is editing, echoed back from the record it read. The service compares it
 * against the row it locks and rejects the write with a 409 when it has moved
 * on, so an editor holding a stale copy cannot silently clobber a teammate's
 * (or the agent's) modules.
 *
 * Layout-only, and optional by design: name and description edits are
 * last-write-wins, and callers that omit it keep the previous semantics.
 */
const expectedUpdatedAtSchema = z
  .string()
  .datetime({ message: 'expectedUpdatedAt must be an ISO 8601 timestamp' })

/**
 * PATCH body — every field but `workspaceId` is optional so callers patch
 * only what changed. `description` is deliberately tri-state: omitted =
 * unchanged, `null` = clear, string = set (the domain record's description is
 * nullable).
 */
export const updateInterfaceBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: interfaceNameSchema.optional(),
    description: interfaceDescriptionSchema.nullable().optional(),
    layout: interfaceLayoutSchema.optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.description !== undefined || body.layout !== undefined,
    { message: 'At least one of name, description, or layout is required' }
  )
  .refine((body) => body.expectedUpdatedAt === undefined || body.layout !== undefined, {
    message: 'expectedUpdatedAt is only valid on a layout write',
    path: ['expectedUpdatedAt'],
  })

export const restoreInterfaceBodySchema = z.object({
  workspaceId: workspaceIdSchema,
})

/**
 * Form submission values, keyed by field **id** (stable across renames) —
 * the server validates them against the stored field defs and rebuilds the
 * workflow input keyed by field name.
 */
export const submitInterfaceFormBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  values: z
    .record(
      z
        .string()
        .min(1, 'Field id cannot be empty')
        .max(
          INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH,
          `Field id must be ${INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH} characters or less`
        ),
      z.union([
        z
          .string()
          .max(
            INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH,
            `Value must be ${INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH} characters or less`
          ),
        z.boolean(),
      ])
    )
    .refine(
      (values) => Object.keys(values).length <= INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS,
      `A submission can include at most ${INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS} values`
    ),
})

export const listInterfacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/interfaces',
  query: listInterfacesQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        interfaces: z.array(interfaceDefinitionSchema),
      })
    ),
  },
})

export const createInterfaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces',
  body: createInterfaceBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(interfaceDefinitionSchema),
  },
})

export const getInterfaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/interfaces/[interfaceId]',
  params: interfaceIdParamsSchema,
  query: getInterfaceQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(interfaceDefinitionSchema),
  },
})

export const updateInterfaceContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/interfaces/[interfaceId]',
  params: interfaceIdParamsSchema,
  body: updateInterfaceBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(interfaceDefinitionSchema),
  },
})

export const deleteInterfaceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/interfaces/[interfaceId]',
  params: interfaceIdParamsSchema,
  query: getInterfaceQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ id: z.string() })),
  },
})

export const restoreInterfaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces/[interfaceId]/restore',
  params: interfaceIdParamsSchema,
  body: restoreInterfaceBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(interfaceDefinitionSchema),
  },
})

export const submitInterfaceFormContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces/[interfaceId]/modules/[moduleId]/submit',
  params: interfaceModuleParamsSchema,
  body: submitInterfaceFormBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        executionId: z.string(),
        // untyped-response: workflow execution output is user-defined
        output: z.unknown(),
      })
    ),
  },
})

export type InterfaceIdParamsInput = z.input<typeof interfaceIdParamsSchema>
export type InterfaceModuleParamsInput = z.input<typeof interfaceModuleParamsSchema>
export type ListInterfacesQueryInput = z.input<typeof listInterfacesQuerySchema>
export type CreateInterfaceBodyInput = z.input<typeof createInterfaceBodySchema>
export type UpdateInterfaceBodyInput = z.input<typeof updateInterfaceBodySchema>
export type RestoreInterfaceBodyInput = z.input<typeof restoreInterfaceBodySchema>
export type SubmitInterfaceFormBodyInput = z.input<typeof submitInterfaceFormBodySchema>
/** Submitted form values, keyed by field id. */
export type SubmitInterfaceFormValues = SubmitInterfaceFormBodyInput['values']

export type ListInterfacesResponse = ContractJsonResponse<typeof listInterfacesContract>
export type CreateInterfaceResponse = ContractJsonResponse<typeof createInterfaceContract>
export type GetInterfaceResponse = ContractJsonResponse<typeof getInterfaceContract>
export type UpdateInterfaceResponse = ContractJsonResponse<typeof updateInterfaceContract>
export type DeleteInterfaceResponse = ContractJsonResponse<typeof deleteInterfaceContract>
export type RestoreInterfaceResponse = ContractJsonResponse<typeof restoreInterfaceContract>
export type SubmitInterfaceFormResponse = ContractJsonResponse<typeof submitInterfaceFormContract>
