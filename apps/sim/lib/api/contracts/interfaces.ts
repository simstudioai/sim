import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { FORM_FIELD_NAME_PATTERN, INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import {
  FORM_FIELD_TYPES,
  type InterfaceDefinition,
  type InterfaceLayout,
  type InterfaceModule,
} from '@/lib/interfaces/types'

/**
 * Boundary contracts for workspace interfaces (`/api/interfaces/**`).
 *
 * Unlike the tables family, the module layout is validated with REAL zod
 * schemas rather than a `domainObjectSchema` passthrough: the layout is
 * user-authored boundary data that the Sim agent also writes, so the schema
 * IS the validation. Structural invariants (module count, unique ids, unique
 * cells, dropdown options) are enforced here; semantic invariants (reserved
 * field names, same-workspace references) live in `@/lib/interfaces`.
 */

/**
 * The persisted interface record, returned directly under `data` (never
 * nested as `data: { interface: ... }` — `interface` is a strict-mode
 * reserved word, so destructuring it is a syntax error waiting to happen).
 * The service guarantees the shape, so the response uses a typed passthrough
 * (the `domainObjectSchema` pattern from `tables.ts`).
 */
const interfaceDefinitionSchema = z.custom<InterfaceDefinition>(isRecordLike)

const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

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
  .max(100, 'Name must be 100 characters or less')

const interfaceDescriptionSchema = z.string().max(500, 'Description must be 500 characters or less')

/** One of the two coordinates of a 2x2 grid cell. */
const cellCoordinateSchema = z.union([z.literal(0), z.literal(1)], {
  error: 'Cell coordinates must be 0 or 1',
})

export const interfaceCellSchema = z.object({
  row: cellCoordinateSchema,
  col: cellCoordinateSchema,
})

/**
 * One selected workflow output, same shape as chat-deployment `outputConfigs`.
 * `path` may be empty — an empty path serializes to `<blockId>_content` on the
 * `selectedOutputs` wire.
 */
export const interfaceOutputConfigSchema = z.object({
  blockId: z.string().min(1, 'Output blockId cannot be empty'),
  path: z
    .string()
    .max(
      INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_PATH_LENGTH,
      `Output path must be ${INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_PATH_LENGTH} characters or less`
    ),
})

export const chatModuleConfigSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID cannot be empty').nullable(),
  outputConfigs: z
    .array(interfaceOutputConfigSchema)
    .max(
      INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_CONFIGS,
      `A chat module can select at most ${INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_CONFIGS} outputs`
    ),
  /** NEW, module-local — no chat-deployment counterpart. true = render streamed block chunks live; false = final outputs only. */
  showThinking: z.boolean(),
  welcomeMessage: z
    .string()
    .max(
      INTERFACE_LAYOUT_LIMITS.MAX_WELCOME_MESSAGE_LENGTH,
      `Welcome message must be ${INTERFACE_LAYOUT_LIMITS.MAX_WELCOME_MESSAGE_LENGTH} characters or less`
    ),
})

export const tableModuleConfigSchema = z.object({
  tableId: z.string().min(1, 'Table ID cannot be empty').nullable(),
})

export const fileModuleConfigSchema = z.object({
  fileId: z.string().min(1, 'File ID cannot be empty').nullable(),
})

export const formFieldTypeSchema = z.enum(FORM_FIELD_TYPES)

export const formFieldSchema = z
  .object({
    /** Stable across edits; wire key for submitted values. */
    id: z
      .string()
      .min(1, 'Field id is required')
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH,
        `Field id must be ${INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH} characters or less`
      ),
    name: z
      .string()
      .min(1, 'Field name is required')
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_FIELD_NAME_LENGTH,
        `Field name must be ${INTERFACE_LAYOUT_LIMITS.MAX_FIELD_NAME_LENGTH} characters or less`
      )
      .regex(FORM_FIELD_NAME_PATTERN, 'Field name must be a valid identifier'),
    label: z
      .string()
      .min(1, 'Field label is required')
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_FIELD_LABEL_LENGTH,
        `Field label must be ${INTERFACE_LAYOUT_LIMITS.MAX_FIELD_LABEL_LENGTH} characters or less`
      ),
    type: formFieldTypeSchema,
    required: z.boolean(),
    placeholder: z
      .string()
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_PLACEHOLDER_LENGTH,
        `Placeholder must be ${INTERFACE_LAYOUT_LIMITS.MAX_PLACEHOLDER_LENGTH} characters or less`
      )
      .optional(),
    hint: z
      .string()
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_HINT_LENGTH,
        `Hint must be ${INTERFACE_LAYOUT_LIMITS.MAX_HINT_LENGTH} characters or less`
      )
      .optional(),
    /** dropdown only; required (>=1) when type === 'dropdown'. */
    options: z
      .array(
        z
          .string()
          .min(1, 'Option cannot be empty')
          .max(
            INTERFACE_LAYOUT_LIMITS.MAX_OPTION_LENGTH,
            `Option must be ${INTERFACE_LAYOUT_LIMITS.MAX_OPTION_LENGTH} characters or less`
          )
      )
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_OPTIONS,
        `A dropdown can have at most ${INTERFACE_LAYOUT_LIMITS.MAX_OPTIONS} options`
      )
      .optional(),
    defaultValue: z
      .union([
        z
          .string()
          .max(
            INTERFACE_LAYOUT_LIMITS.MAX_DEFAULT_VALUE_LENGTH,
            `Default value must be ${INTERFACE_LAYOUT_LIMITS.MAX_DEFAULT_VALUE_LENGTH} characters or less`
          ),
        z.boolean(),
      ])
      .optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'dropdown' && (field.options?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `Dropdown field "${field.name}" must define at least one option`,
      })
    }
  })

const interfaceModuleBaseShape = {
  /** Stable across moves. */
  id: z
    .string()
    .min(1, 'Module id is required')
    .max(
      INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH,
      `Module id must be ${INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH} characters or less`
    ),
  cell: interfaceCellSchema,
}

export const formModuleConfigSchema = z
  .object({
    workflowId: z.string().min(1, 'Workflow ID cannot be empty').nullable(),
    fields: z
      .array(formFieldSchema)
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS,
        `A form can have at most ${INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS} fields`
      ),
    /** Default 'Submit' (applied by module defaults, not the schema). */
    submitLabel: z
      .string()
      .min(1, 'Submit label is required')
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_SUBMIT_LABEL_LENGTH,
        `Submit label must be ${INTERFACE_LAYOUT_LIMITS.MAX_SUBMIT_LABEL_LENGTH} characters or less`
      ),
  })
  .superRefine((config, ctx) => {
    const seenNames = new Map<string, number>()
    const seenIds = new Map<string, number>()
    config.fields.forEach((field, index) => {
      const nameIndex = seenNames.get(field.name)
      if (nameIndex !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'name'],
          message: `Field name "${field.name}" is already used by field ${nameIndex + 1}`,
        })
      } else {
        seenNames.set(field.name, index)
      }
      const idIndex = seenIds.get(field.id)
      if (idIndex !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'id'],
          message: `Field id "${field.id}" is already used by field ${idIndex + 1}`,
        })
      } else {
        seenIds.set(field.id, index)
      }
    })
  })

export const interfaceModuleSchema = z.discriminatedUnion('type', [
  z.object({
    ...interfaceModuleBaseShape,
    type: z.literal('chat'),
    config: chatModuleConfigSchema,
  }),
  z.object({
    ...interfaceModuleBaseShape,
    type: z.literal('table'),
    config: tableModuleConfigSchema,
  }),
  z.object({
    ...interfaceModuleBaseShape,
    type: z.literal('file'),
    config: fileModuleConfigSchema,
  }),
  z.object({
    ...interfaceModuleBaseShape,
    type: z.literal('form'),
    config: formModuleConfigSchema,
  }),
]) satisfies z.ZodType<InterfaceModule>

export const interfaceLayoutSchema = (
  z.object({
    version: z.literal(1),
    modules: z
      .array(interfaceModuleSchema)
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_MODULES,
        `An interface can have at most ${INTERFACE_LAYOUT_LIMITS.MAX_MODULES} modules`
      ),
  }) satisfies z.ZodType<InterfaceLayout>
).superRefine((layout, ctx) => {
  const seenCells = new Map<string, number>()
  const seenIds = new Map<string, number>()
  layout.modules.forEach((module, index) => {
    const cellKey = `${module.cell.row},${module.cell.col}`
    const cellIndex = seenCells.get(cellKey)
    if (cellIndex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['modules', index, 'cell'],
        message: `Cell (row ${module.cell.row}, col ${module.cell.col}) is already occupied by module "${layout.modules[cellIndex].id}"`,
      })
    } else {
      seenCells.set(cellKey, index)
    }
    const idIndex = seenIds.get(module.id)
    if (idIndex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['modules', index, 'id'],
        message: `Module id "${module.id}" is already used by module ${idIndex + 1}`,
      })
    } else {
      seenIds.set(module.id, index)
    }
  })
})

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
  values: z.record(
    z.string().min(1, 'Field id cannot be empty'),
    z.union([
      z
        .string()
        .max(
          INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH,
          `Value must be ${INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH} characters or less`
        ),
      z.boolean(),
    ])
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
