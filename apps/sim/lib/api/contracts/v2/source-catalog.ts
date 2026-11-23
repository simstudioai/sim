import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * The source catalog, the workflow-SDK block catalog: one content-hashed JSON document the
 * compiler, printer, and type generator read instead of the block, trigger, and tool registries.
 *
 * The response is the catalog's core shard (`BlockCatalog` in `@sim/workflow-code`, which owns
 * the shape; this schema mirrors it field for field, and the registry-wide catalog test parses
 * the whole projection through it so a field added there and missed here fails CI instead of
 * being stripped). Its `hash` is the content hash of everything else in it, and the route sends it
 * as a strong `ETag`; a caller holding a copy sends it back as `If-None-Match` and gets `304` with
 * no body when nothing changed. That is a deliberate exception to v2's no-ETag rule: the document
 * is megabytes, is already content-addressed, and is what a workflow lock pins, so revalidating by
 * hash is the read's whole purpose.
 *
 * The core shard never stores a value twice: a block's trigger-mode fields reference the shared
 * `triggers` table, and repeated fields, condition lists and output records live once in the
 * `subBlocks`, `lists` and `outputs` tables. Readers expand it with `expandBlockCatalog` (or the
 * per-block accessors) from `@sim/workflow-code` rather than walking these references themselves.
 */

const v2SourceCatalogQuerySchema = z
  .object({
    workflowId: workflowIdSchema
      .optional()
      .describe(
        'Return the source catalog for this workflow: the workspace catalog plus every block type already placed in it, the ones the caller could not add marked `addable: false`.'
      ),
  })
  .strict()

const v2SourceCatalogParamsSchema = z.object({
  workspaceId: workspaceIdSchema.describe(
    'Workspace whose integration allowlist, revealed preview blocks, and deployed custom blocks decide what the catalog contains.'
  ),
})

const v2SourceCatalogHeadersSchema = z.object({
  'if-none-match': z
    .string()
    .max(1024, 'if-none-match must be at most 1024 characters')
    .optional()
    .describe('A catalog `hash` (quoted, as sent in `ETag`) the caller already holds.'),
})

const scalarSchema = z.union([z.string(), z.number(), z.boolean()])

const listRefSchema = z
  .strictObject({
    list: z.number().int().nonnegative().describe('Index into the catalog `lists` table.'),
  })
  .describe('A value list stored once in the catalog `lists` table.')

const conditionValueSchema = z
  .union([scalarSchema, z.array(scalarSchema), listRefSchema])
  .describe(
    'Value, or set of accepted values, the named field must hold; a set may be a `lists` reference.'
  )

const opaqueSchema = z
  .object({ opaque: z.literal(true).describe('Always true.') })
  .describe('A function the catalog could not evaluate to data.')

const conditionClauseSchema = z
  .object({
    field: z.string().describe('Sibling field id whose value decides the condition.'),
    value: conditionValueSchema,
    not: z.boolean().optional().describe('Invert the match.'),
    and: z
      .object({
        field: z.string().describe('Second field id.'),
        value: conditionValueSchema.optional(),
        not: z.boolean().optional().describe('Invert the second match.'),
      })
      .optional()
      .describe('A second clause that must hold as well.'),
  })
  .describe('Holds when `field` holds `value`.')

const catalogConditionSchema = z
  .union([conditionClauseSchema, opaqueSchema])
  .describe('A condition clause, or `{ opaque: true }` (treat as possibly holding).')

const catalogOptionSchema = z
  .object({
    id: z.string().describe('Stored option id.'),
    label: z
      .string()
      .optional()
      .describe(
        "Display label; absent when it equals `id`, and on a block's non-`operation` fields."
      ),
  })
  .describe('One static option.')

const catalogSubBlockSchema = z
  .object({
    id: z
      .string()
      .describe('Field id; the param name unless the field is in a basic/advanced pair.'),
    type: z.string().describe('Editor control type, e.g. `short-input`.'),
    title: z.string().optional().describe('Display title.'),
    mode: z
      .enum(['basic', 'advanced', 'both', 'trigger', 'trigger-advanced'])
      .optional()
      .describe('Which editor mode shows the field.'),
    canonicalParamId: z.string().optional().describe('Shared param name of a basic/advanced pair.'),
    surface: z
      .enum(['action', 'trigger'])
      .optional()
      .describe('Whether this declaration belongs to action or trigger mode.'),
    condition: catalogConditionSchema.optional(),
    visibleFor: z
      .record(z.string(), z.boolean())
      .optional()
      .describe('Per operation id: whether an opaque condition can show this field.'),
    visibleWhen: z
      .record(z.string(), conditionClauseSchema)
      .optional()
      .describe(
        'Per operation id: the clause on other fields an opaque condition still asks to show this field.'
      ),
    visibleForModel: z
      .record(z.string(), z.boolean())
      .optional()
      .describe('Per model id: whether an opaque condition shows this field.'),
    required: z
      .union([z.boolean(), catalogConditionSchema])
      .optional()
      .describe('Whether a value is required, or the condition under which it is.'),
    dependsOn: z
      .object({
        all: z.array(z.string()).describe('Fields that must all hold values.'),
        any: z.array(z.string()).describe('Fields of which one must hold a value.'),
      })
      .optional()
      .describe('Editor clearing and fetch ordering hints; never visibility.'),
    defaultValue: z.unknown().optional().describe('Editor default value (any JSON).'),
    valueDefault: z
      .union([
        z
          .object({
            computed: z.literal(true).describe('Always true.'),
            initial: z
              .unknown()
              .optional()
              .describe(
                'What the thunk returns for a new block with no values (any JSON), when stable.'
              ),
          })
          .describe('A value thunk derived from other params.'),
        z
          .strictObject({ constant: z.unknown().describe('The constant value (any JSON).') })
          .describe('A value thunk that always returns this.'),
      ])
      .optional()
      .describe('The registry value thunk, evaluated where it is constant.'),
    options: z
      .union([
        z.array(catalogOptionSchema),
        z
          .object({ dynamic: z.literal(true).describe('Always true.') })
          .describe('Options fetched per workspace through `selectorKey`.'),
        opaqueSchema,
      ])
      .optional()
      .describe('Selectable options.'),
    optionsVary: z
      .literal(true)
      .optional()
      .describe(
        'The options depend on deployment settings and were evaluated where this catalog was built; the write-time check evaluates them again.'
      ),
    hidden: z.boolean().optional().describe('Hidden from the editor.'),
    readOnly: z.boolean().optional().describe('Display-only.'),
    password: z.boolean().optional().describe('Holds a secret.'),
    hideFromCopilot: z.boolean().optional().describe('Not offered to Copilot.'),
    context: z.literal('tool-input').optional().describe('Only meaningful as an agent tool.'),
    paramVisibility: z.string().optional().describe('Tool param visibility override.'),
    emptyIsValid: z.boolean().optional().describe('An empty value satisfies `required`.'),
    language: z.string().optional().describe('Code field language.'),
    multiple: z.boolean().optional().describe('Accepts several files.'),
    min: z.number().optional().describe('Minimum numeric value.'),
    max: z.number().optional().describe('Maximum numeric value.'),
    step: z.number().optional().describe('Slider increment.'),
    integer: z.boolean().optional().describe('Integers only.'),
    columns: z.array(z.string()).optional().describe('Table column headers.'),
    selectorKey: z.string().optional().describe('Selector that lists the options.'),
    serviceId: z.string().optional().describe('OAuth service the field binds.'),
    credentialProviders: z
      .array(z.string())
      .optional()
      .describe('Provider ids of the saved credentials the field accepts.'),
    valueKind: z
      .enum([
        'string',
        'number',
        'boolean',
        'array',
        'object',
        'json',
        'code',
        'branches',
        'tools',
        'resource',
        'picked',
        'upload',
        'none',
      ])
      .describe('How a value for this field is written in source.'),
    resourceKind: z.string().optional().describe('Workspace resource kind, for `resource` fields.'),
    storage: z.enum(['native', 'json-string']).describe('Encoding a new value is stored with.'),
    structured: z
      .enum(['tools', 'branches', 'tableRows', 'inputFormat', 'variables', 'skills'])
      .optional()
      .describe('Structured value the canonical model decodes.'),
    acceptsNumber: z
      .boolean()
      .optional()
      .describe('Free text that also takes a number, which the runtime coerces.'),
    neverDecoded: z
      .boolean()
      .optional()
      .describe('User text whose JSON-looking content is never decoded.'),
    tableFilter: z.boolean().optional().describe('A table filter: builder rows or a predicate.'),
    valueShape: z
      .enum(['number', 'boolean', 'json'])
      .optional()
      .describe('Shape of the value in an agent tool entry; absent means string.'),
  })
  .describe('One configuration field, in declared order; duplicate ids are kept with `surface`.')

const catalogOutputSchema = z
  .object({
    type: z.string().describe('Output value type.'),
    description: z.string().optional().describe('What the output holds.'),
    condition: z
      .unknown()
      .optional()
      .describe('When the output is present: `{ field, value, not?, and? }`.'),
    hiddenFromDisplay: z.boolean().optional().describe('Hidden from the output picker.'),
    properties: z
      .record(z.string(), z.unknown().describe('A nested output, of this same shape.'))
      .optional()
      .describe('Nested outputs by name, each of this same shape.'),
    sharedProperties: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('In place of `properties`: index of the nested outputs in the catalog `outputs`.'),
    items: z.unknown().optional().describe('Array element output, of this same shape.'),
  })
  .describe('One output field.')

const catalogOutputsSchema = z
  .record(z.string(), catalogOutputSchema)
  .describe('Declared outputs by name.')

const sharedOutputsSchema = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe('In place of `outputs`: index of the outputs in the catalog `outputs` table.')

const sharedSubBlockRefSchema = z
  .strictObject({
    shared: z.number().int().nonnegative().describe('Index into the catalog `subBlocks` table.'),
  })
  .describe('A field stored once in the catalog `subBlocks` table.')

const triggerSubBlocksRefSchema = z
  .strictObject({
    trigger: z.string().describe('Trigger id in the catalog `triggers` table.'),
    start: z.number().int().nonnegative().describe('First of that trigger’s fields in the run.'),
    count: z.number().int().positive().describe('How many consecutive fields the run holds.'),
  })
  .describe('A run of a shared trigger’s fields, spliced in place, each with `surface: "trigger"`.')

const catalogBlockSchema = z
  .object({
    type: z.string().describe('Block type id.'),
    name: z.string().describe('Display name.'),
    category: z.enum(['blocks', 'tools', 'triggers']).describe('Block category.'),
    addable: z
      .literal(false)
      .optional()
      .describe('Present when new blocks of this type are refused; existing ones still compile.'),
    lifecycle: z
      .object({
        hidden: z.literal(true).optional().describe('Hidden from the toolbar.'),
        preview: z.literal(true).optional().describe('Unreleased preview block.'),
        sunset: z
          .object({
            status: z.enum(['legacy', 'deprecated']).describe('Lifecycle state.'),
            replacedBy: z.string().optional().describe('Successor block type.'),
          })
          .optional()
          .describe('Post-GA lifecycle state.'),
      })
      .optional()
      .describe('Lifecycle flags.'),
    triggerAllowed: z.boolean().optional().describe('Whether the block can start a workflow.'),
    triggers: z
      .object({
        enabled: z.boolean().describe('Whether trigger mode is available.'),
        available: z.array(z.string()).describe('Trigger ids the block supports.'),
      })
      .optional()
      .describe('Trigger mode support.'),
    singleInstance: z.boolean().optional().describe('At most one per workflow.'),
    subBlocks: z
      .array(z.union([catalogSubBlockSchema, sharedSubBlockRefSchema, triggerSubBlocksRefSchema]))
      .describe('Configuration fields in declared order, inline or by reference.'),
    tools: z
      .object({
        access: z.array(z.string()).describe('Tool ids the block can call.'),
        selector: z
          .enum(['single', 'operation', 'opaque'])
          .describe('How the tool is chosen: fixed, by operation, or by an unevaluated function.'),
      })
      .describe('Tools the block calls.'),
    outputs: catalogOutputsSchema.optional(),
    sharedOutputs: sharedOutputsSchema,
    operationOutputs: z
      .record(
        z.string(),
        z.object({
          names: z.array(z.string()).describe('Block outputs the operation returns, in order.'),
          nullable: z
            .array(z.string())
            .optional()
            .describe('Those of them the operation may return as null.'),
        })
      )
      .optional()
      .describe('Per operation id: the outputs its tool returns, where they differ.'),
    dynamicOutputs: z
      .object({
        source: z
          .enum(['responseFormat', 'inputFormat', 'humanForm', 'tableRows'])
          .describe('What shapes the outputs.'),
        param: z.string().describe('Param holding that shape.'),
      })
      .optional()
      .describe('Present when outputs derive from a param at run time.'),
    graph: z
      .object({
        canBeTarget: z.boolean().describe('Whether an edge may connect into the block.'),
        errorPort: z.boolean().describe('Whether the block has an error port.'),
        container: z
          .enum(['loop', 'parallel'])
          .nullable()
          .describe('The subflow kind for a container, else null.'),
        annotationOnly: z.boolean().describe('A canvas note: no edges at all.'),
        branches: z
          .object({
            subBlockId: z.string().describe('Field holding the branches.'),
            kind: z.enum(['condition', 'router']).describe('Branch kind.'),
          })
          .optional()
          .describe('The field lifted into named branches.'),
      })
      .describe('Edge rules for the block.'),
    legacyIds: z
      .array(
        z
          .object({
            from: z.string().describe('Legacy field id.'),
            to: z.string().nullable().describe('Current field id, or null when removed.'),
            whenOperation: z
              .array(z.string())
              .optional()
              .describe('Operations the rename applies to.'),
            conditional: z.literal(true).optional().describe('Applies only to some values.'),
          })
          .describe('One field id rename.')
      )
      .optional()
      .describe('Field id renames applied on load.'),
    legacyCanonicalIds: z
      .array(
        z
          .object({
            from: z.string().describe('Legacy pair id.'),
            to: z.string().describe('Current pair id.'),
          })
          .describe('One pair id rename.')
      )
      .optional()
      .describe('Basic/advanced pair id renames applied on load.'),
    paramAliases: z
      .object({
        action: z.record(z.string(), z.string()).optional().describe('Action-surface aliases.'),
        trigger: z.record(z.string(), z.string()).optional().describe('Trigger-surface aliases.'),
      })
      .optional()
      .describe('The name source writes for a param, by param name: oauthCredential → credential.'),
    custom: z
      .object({
        sourceWorkflowId: z.string().optional().describe('Workflow the custom block runs.'),
      })
      .optional()
      .describe('Present for organization custom blocks.'),
  })
  .describe('One placeable block type.')

const catalogTriggerSchema = z
  .object({
    id: z.string().describe('Trigger id.'),
    provider: z.string().describe('Provider the trigger belongs to.'),
    name: z.string().describe('Display name.'),
    polling: z.boolean().optional().describe('Poll-based rather than webhook-based.'),
    webhook: z.boolean().optional().describe('Receives webhooks.'),
    subBlocks: z
      .array(z.union([catalogSubBlockSchema, sharedSubBlockRefSchema]))
      .describe('Configuration fields in declared order, inline or by reference.'),
    outputs: catalogOutputsSchema.optional(),
    sharedOutputs: sharedOutputsSchema,
  })
  .describe('One trigger a block can run in trigger mode.')

const catalogBuilderSchema = z
  .object({
    type: z.string().describe('Block type the builder creates.'),
    operation: z.string().optional().describe('Stored operation id the builder pins.'),
    triggerMode: z
      .boolean()
      .optional()
      .describe('Whether the builder creates a trigger-mode block.'),
    fixed: z
      .record(z.string(), z.string())
      .optional()
      .describe('Other field values the builder pins, such as the selected trigger.'),
  })
  .describe('One SDK builder method.')

export const v2SourceCatalogSchema = z
  .object({
    catalogVersion: z.literal(1).describe('Catalog format version.'),
    hash: z.string().describe('SHA-256 of the catalog content; the response `ETag`.'),
    sdkMajor: z.number().int().describe('Workflow SDK major version this catalog serves.'),
    blocks: z.record(z.string(), catalogBlockSchema).describe('Placeable block types by type id.'),
    triggers: z
      .record(z.string(), catalogTriggerSchema)
      .describe('Triggers the listed blocks can run, by trigger id.'),
    builders: z
      .record(z.string(), catalogBuilderSchema)
      .describe('SDK builder methods keyed by dotted path, e.g. `slack.sendMessage`.'),
    subBlocks: z
      .array(catalogSubBlockSchema)
      .optional()
      .describe('Fields declared identically by several blocks or triggers, stored once.'),
    lists: z
      .array(z.array(scalarSchema))
      .optional()
      .describe('Condition value lists used by several fields, stored once.'),
    outputs: z
      .array(catalogOutputsSchema)
      .optional()
      .describe('Output records repeated across blocks and triggers, stored once.'),
    scope: z
      .object({
        organizationId: z.string().describe('Organization whose custom blocks are included.'),
      })
      .optional()
      .describe('Present when the catalog includes an organization’s custom blocks.'),
  })
  .describe('Source catalog core shard.')

export const v2GetSourceCatalogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/workflows/source/catalog',
  params: v2SourceCatalogParamsSchema,
  query: v2SourceCatalogQuerySchema,
  headers: v2SourceCatalogHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2SourceCatalogSchema) },
})
