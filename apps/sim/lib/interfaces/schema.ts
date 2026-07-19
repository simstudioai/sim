/**
 * Zod schemas for the interface layout — the single structural validator for
 * every layout write. The HTTP boundary contract (`@/lib/api/contracts/
 * interfaces`) declares these schemas on the wire, and `validateLayout` runs
 * the same schemas for non-HTTP writers (the copilot `user_interface` tool),
 * so a structural rule can never drift between the two paths.
 *
 * Geometry invariants (a placement fits the layout's own grid; no two
 * placements overlap) are asserted with the shared predicates from
 * `@/lib/interfaces/geometry` rather than re-derived here, so the rule the
 * validator enforces is literally the rule the canvas and the service apply.
 *
 * Database-free by construction (imports only zod, `constants.ts`,
 * `geometry.ts`, and `types.ts`), so it is safe on both sides of the client
 * boundary — see the module note in `constants.ts`.
 */

import { z } from 'zod'
import {
  FORM_FIELD_NAME_PATTERN,
  INTERFACE_LAYOUT_LIMITS,
  isReservedFormFieldName,
  RESERVED_FORM_FIELD_NAMES,
} from '@/lib/interfaces/constants'
import { placementFitsGrid, placementsOverlap } from '@/lib/interfaces/geometry'
import {
  FORM_FIELD_TYPES,
  type InterfaceLayout,
  type InterfaceModule,
  type InterfacePlacement,
} from '@/lib/interfaces/types'

/**
 * Per-field caps on a placement. These only keep a coordinate inside the
 * largest grid the domain permits — whether it fits the layout's OWN grid is
 * checked by {@link interfaceLayoutSchema}, which is the only scope that knows
 * the grid.
 */
function trackIndexSchema(field: string, max: number) {
  return z
    .number()
    .int({ error: `${field} must be a whole number` })
    .min(0, `${field} cannot be negative`)
    .max(max - 1, `${field} must be less than ${max}`)
}

function trackSpanSchema(field: string, max: number) {
  return z
    .number()
    .int({ error: `${field} must be a whole number` })
    .min(1, `${field} must be at least 1`)
    .max(max, `${field} must be ${max} or less`)
}

export const interfaceGridSchema = z.object({
  rows: trackSpanSchema('Grid rows', INTERFACE_LAYOUT_LIMITS.MAX_GRID_ROWS),
  cols: trackSpanSchema('Grid columns', INTERFACE_LAYOUT_LIMITS.MAX_GRID_COLS),
})

/** A module's rectangle: top-left corner plus how many tracks it covers. */
export const interfacePlacementSchema = z.object({
  row: trackIndexSchema('Placement row', INTERFACE_LAYOUT_LIMITS.MAX_GRID_ROWS),
  col: trackIndexSchema('Placement column', INTERFACE_LAYOUT_LIMITS.MAX_GRID_COLS),
  rowSpan: trackSpanSchema('Placement rowSpan', INTERFACE_LAYOUT_LIMITS.MAX_GRID_ROWS),
  colSpan: trackSpanSchema('Placement colSpan', INTERFACE_LAYOUT_LIMITS.MAX_GRID_COLS),
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
    if (isReservedFormFieldName(field.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: `Field name "${field.name}" is reserved. Reserved names are: ${RESERVED_FORM_FIELD_NAMES.join(', ')}`,
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
  placement: interfacePlacementSchema,
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
    if (config.submitLabel.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['submitLabel'],
        message: 'Submit label is required',
      })
    }
    /**
     * Names are deduplicated case-insensitively: they become workflow
     * start-block input keys, and two fields differing only by case are a
     * user error waiting to happen even though the executor could key them.
     */
    const seenNames = new Map<string, number>()
    const seenIds = new Map<string, number>()
    config.fields.forEach((field, index) => {
      const loweredName = field.name.toLowerCase()
      const nameIndex = seenNames.get(loweredName)
      if (nameIndex !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'name'],
          message: `Field name "${field.name}" is already used by field ${nameIndex + 1}`,
        })
      } else {
        seenNames.set(loweredName, index)
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

/** `(row 0, col 1)` for a single cell, `(rows 0-1, cols 0-1)` for a span. */
function describePlacement(placement: InterfacePlacement): string {
  const rows =
    placement.rowSpan === 1
      ? `row ${placement.row}`
      : `rows ${placement.row}-${placement.row + placement.rowSpan - 1}`
  const cols =
    placement.colSpan === 1
      ? `col ${placement.col}`
      : `cols ${placement.col}-${placement.col + placement.colSpan - 1}`
  return `(${rows}, ${cols})`
}

export const interfaceLayoutSchema = (
  z.object({
    version: z.literal(1, { error: 'Unsupported layout version' }),
    grid: interfaceGridSchema,
    modules: z
      .array(interfaceModuleSchema)
      .max(
        INTERFACE_LAYOUT_LIMITS.MAX_MODULES,
        `An interface can have at most ${INTERFACE_LAYOUT_LIMITS.MAX_MODULES} modules`
      ),
  }) satisfies z.ZodType<InterfaceLayout>
).superRefine((layout, ctx) => {
  const seenIds = new Map<string, number>()

  layout.modules.forEach((module, index) => {
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

    if (!placementFitsGrid(module.placement, layout.grid)) {
      ctx.addIssue({
        code: 'custom',
        path: ['modules', index, 'placement'],
        message: `Module "${module.id}" at ${describePlacement(module.placement)} does not fit the ${layout.grid.rows}x${layout.grid.cols} grid`,
      })
    }
  })

  /**
   * Pairwise rather than a cell sweep: it is exact for spanning modules and
   * bounded by {@link INTERFACE_LAYOUT_LIMITS.MAX_MODULES}, so the quadratic
   * term is negligible. Reported on the later module so the message always
   * names the one that arrived to a filled space.
   */
  for (let i = 0; i < layout.modules.length; i++) {
    for (let j = i + 1; j < layout.modules.length; j++) {
      const earlier = layout.modules[i]
      const later = layout.modules[j]
      if (!placementsOverlap(earlier.placement, later.placement)) continue
      ctx.addIssue({
        code: 'custom',
        path: ['modules', j, 'placement'],
        message: `Module "${later.id}" at ${describePlacement(later.placement)} overlaps module "${earlier.id}" at ${describePlacement(earlier.placement)}`,
      })
    }
  }
})
