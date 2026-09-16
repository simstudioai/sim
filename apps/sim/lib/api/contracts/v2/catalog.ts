import { z } from 'zod'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 catalog contracts: the code-defined blocks, tools, and connector types a
 * caller can build with.
 *
 * These read like static reference data and are not: what a caller may place is
 * decided per workspace by its permission-group integration allowlist, per
 * organization by which unreleased blocks have been revealed, per deployment by
 * `ALLOWED_INTEGRATIONS`, and per workspace again by the workflows it has
 * deployed as blocks. So every operation takes a `workspaceId` and every
 * response is `Cache-Control: private, no-store` like the rest of v2 — an
 * unrevealed preview block's existence must not leak across organizations
 * through a shared cache.
 *
 * The list/detail split is what keeps the lists bounded: a block summary names
 * its tools and operations by id, and resolving one is a second call. Projecting
 * all 300-odd blocks with every field, operation, and tool schema would be
 * several megabytes.
 */

const catalogIdSchema = z
  .string()
  .trim()
  .min(1, 'id cannot be empty')
  .max(255, 'id must be at most 255 characters')

/**
 * Ceiling on how long a caller may hold a tool call open.
 *
 * A tool call is one outbound request to a third party, so the wait is bounded
 * by what the platform will hold a connection for rather than by anything the
 * tool declares. Five minutes is the same order as the executor's per-tool
 * default and well inside the request budget.
 */
export const V2_TOOL_EXECUTION_MAX_TIMEOUT_SECONDS = 300

/** Workspace whose availability rules are applied to every catalog read. */
const catalogWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe(
      'Workspace whose integration allowlist, revealed preview blocks, and deployed custom blocks decide what this catalog contains.'
    ),
  })
  .strict()

const catalogConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
])

/**
 * When a configuration field applies: "the field named by `field` holds
 * `value`". `not` inverts the match, and `and` adds a second clause that must
 * hold as well.
 */
export const v2CatalogConditionSchema = z
  .object({
    field: z.string().describe('Sibling field id whose value decides this condition.'),
    value: catalogConditionValueSchema.describe(
      'Value, or set of accepted values, the named field must hold.'
    ),
    not: z.boolean().optional().describe('Invert the match: every value EXCEPT `value`.'),
    and: z
      .object({
        field: z.string().describe('Sibling field id for the second clause.'),
        value: catalogConditionValueSchema
          .optional()
          .describe('Value the second clause matches. Absent means "holds any value".'),
        not: z.boolean().optional().describe('Invert the second clause.'),
      })
      .optional()
      .describe('A second clause that must hold as well.'),
  })
  .meta({
    id: 'V2CatalogCondition',
    title: 'Catalog condition',
    description: 'When a configuration field applies, expressed against a sibling field.',
  })
export type V2CatalogCondition = z.output<typeof v2CatalogConditionSchema>

const catalogDependsOnSchema = z.union([
  z.array(z.string()),
  z.object({
    all: z.array(z.string()).optional().describe('Every listed field must hold a value.'),
    any: z.array(z.string()).optional().describe('At least one listed field must hold a value.'),
  }),
])

/** One configuration field on a block. */
export const v2BlockFieldSchema = z
  .object({
    id: z.string().describe('Field identifier, and the key its value is stored under.'),
    type: z.string().describe('Editor control the field renders as, e.g. `short-input`.'),
    title: z.string().optional().describe('Human-readable label.'),
    required: z
      .boolean()
      .optional()
      .describe(
        'Whether a value must be supplied. A conditionally required field reports `true` and carries `requiredWhen`.'
      ),
    requiredWhen: v2CatalogConditionSchema
      .optional()
      .describe('Condition under which the field is required.'),
    description: z.string().optional().describe('Authored explanation of the field.'),
    placeholder: z.string().optional().describe('Placeholder shown in the editor.'),
    mode: z
      .string()
      .optional()
      .describe(
        'Where the field renders: `basic`, `advanced`, `both`, `trigger`, or `trigger-advanced`.'
      ),
    hidden: z.boolean().optional().describe('Whether the field is hidden in the editor.'),
    condition: v2CatalogConditionSchema
      .optional()
      .describe('Condition under which the field applies at all.'),
    options: z
      .array(
        z.object({
          id: z.string().describe('Value stored when this option is selected.'),
          label: z.string().optional().describe('Human-readable option label.'),
          hasIcon: z
            .boolean()
            .optional()
            .describe('Whether the option renders with an icon. The icon itself is not published.'),
        })
      )
      .optional()
      .describe(
        'Selectable options. Absent on fields whose options are fetched per workspace at edit time.'
      ),
    min: z.number().optional().describe('Minimum accepted numeric value.'),
    max: z.number().optional().describe('Maximum accepted numeric value.'),
    step: z.number().optional().describe('Increment for numeric controls.'),
    integer: z.boolean().optional().describe('Whether the numeric value must be a whole number.'),
    rows: z.number().optional().describe('Visible row count for multi-line text.'),
    password: z.boolean().optional().describe('Whether the stored value is masked in the editor.'),
    multiSelect: z.boolean().optional().describe('Whether more than one option may be selected.'),
    language: z.string().optional().describe('Language of a code field.'),
    generationType: z.string().optional().describe('Kind of content AI assistance generates here.'),
    serviceId: z.string().optional().describe('OAuth service this credential field authenticates.'),
    requiredScopes: z
      .array(z.string())
      .optional()
      .describe('OAuth scopes the credential selected here must carry.'),
    mimeType: z.string().optional().describe('MIME type filter applied to a file picker.'),
    acceptedTypes: z.string().optional().describe('Accepted file extensions for an upload field.'),
    multiple: z.boolean().optional().describe('Whether more than one file may be supplied.'),
    maxSize: z.number().optional().describe('Maximum upload size in megabytes.'),
    connectionDroppable: z
      .boolean()
      .optional()
      .describe('Whether another block’s output can be dropped onto this field.'),
    columns: z.array(z.string()).optional().describe('Column headings for a table field.'),
    dependsOn: catalogDependsOnSchema
      .optional()
      .describe('Sibling fields this field is cleared by when they change.'),
    canonicalParamId: z
      .string()
      .optional()
      .describe(
        'Shared key for a picker/manual-entry pair. Both fields write the same value, so supply exactly one of the pair.'
      ),
    defaultValue: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.unknown().describe('Member of an object-valued default. Shape varies by field type.')
        ),
        z.array(
          z.unknown().describe('Element of an array-valued default. Shape varies by field type.')
        ),
      ])
      .optional()
      .describe('Value used when the field is left unset.'),
    hasComputedDefault: z
      .boolean()
      .optional()
      .describe(
        'Whether the field derives its value from the block’s other values. The deriving function is not published.'
      ),
  })
  .meta({
    id: 'V2BlockField',
    title: 'Block field',
    description: 'One configuration field on a block.',
  })
export type V2BlockField = z.output<typeof v2BlockFieldSchema>

const catalogBlockSourceSchema = z
  .enum(['builtin', 'custom'])
  .describe(
    'Block source: `builtin` for built-in blocks, or `custom` for workflows this workspace deployed as blocks.'
  )

/** Summary view of a block. */
export const v2BlockSummarySchema = z
  .object({
    id: z.string().describe('Block type identifier, used as a workflow block’s `type`.'),
    name: z.string().describe('Display name.'),
    description: z.string().describe('One-line summary of what the block does.'),
    longDescription: z
      .string()
      .optional()
      .describe('Extended explanation, when the block has one.'),
    category: z.string().describe('Toolbar category: `blocks`, `tools`, or `triggers`.'),
    integrationType: z
      .string()
      .optional()
      .describe('Integration category, e.g. `communication`, `databases`.'),
    source: catalogBlockSourceSchema,
    authMode: z
      .string()
      .optional()
      .describe('How the block authenticates: `oauth`, `api_key`, or `bot_token`.'),
    triggerAllowed: z.boolean().describe('Whether the block declares itself usable as a trigger.'),
    triggerCapable: z
      .boolean()
      .describe(
        'Whether the block can start a workflow — a trigger-category block, one declaring `triggerAllowed`, or one with trigger-mode fields.'
      ),
    triggerIds: z.array(z.string()).describe('Identifiers of the triggers this block supports.'),
    toolIds: z
      .array(z.string())
      .describe(
        'Built-in tools this block can run. Read a tool by its id for the full definition.'
      ),
    operationIds: z
      .array(z.string())
      .describe('Operations this block exposes. Their fields and tools are on the block read.'),
    preview: z
      .boolean()
      .describe('Whether the block is unreleased and revealed only to this caller.'),
    sunset: z
      .object({
        status: z
          .enum(['legacy', 'deprecated'])
          .describe('`legacy` is superseded but supported; `deprecated` is slated for removal.'),
        replacedBy: z.string().optional().describe('Block type to migrate to, when one exists.'),
      })
      .optional()
      .describe('Post-release lifecycle state. Absent for a block in normal support.'),
    docsLink: z.string().optional().describe('Sim documentation page for the integration.'),
    tags: z.array(z.string()).describe('Catalog tags, e.g. `messaging`, `version-control`.'),
  })
  .meta({
    id: 'V2BlockSummary',
    title: 'Block summary',
    description: 'List view of a block: what it is and what it references, by id.',
  })
export type V2BlockSummary = z.output<typeof v2BlockSummarySchema>

const v2BlockOutputSchema = z.object({
  type: z.string().describe('Value type of the output.'),
  description: z.string().optional().describe('What the output holds.'),
})

/** Block-level input definition. */
const v2BlockInputDefinitionSchema = z.object({
  type: z
    .string()
    .describe('Value type: `string`, `number`, `boolean`, `json`, `array`, or `file`.'),
  description: z.string().optional().describe('What the input means.'),
  // untyped-response: block input JSON Schema is authored per block and arbitrarily nested
  schema: z
    .unknown()
    .optional()
    .describe('JSON-Schema-shaped structure for object and array inputs.'),
})

const v2ToolParamSchema = z
  .object({
    type: z.string().describe('Parameter value type.'),
    required: z.boolean().optional().describe('Whether the parameter must be supplied.'),
    visibility: z
      .string()
      .optional()
      .describe('Who may supply the value: `user-or-llm`, `user-only`, `llm-only`, or `hidden`.'),
    description: z.string().optional().describe('What the parameter means.'),
    default: z.unknown().optional().describe('Value used when the parameter is omitted.'),
    // untyped-response: tool param JSON Schema is provider-defined and arbitrarily nested
    items: z.unknown().optional().describe('JSON-Schema-shaped constraints for structured params.'),
  })
  .meta({
    id: 'V2ToolParam',
    title: 'Tool parameter',
    description: 'One declared parameter of a built-in tool.',
  })
export type V2ToolParam = z.output<typeof v2ToolParamSchema>

/**
 * One declared output field of a tool.
 *
 * An object output's members and an array output's element shape are published
 * open rather than as a self-referential schema. That is the same treatment
 * `V2McpTool.inputSchema` gives a server-authored argument schema, and it is
 * what keeps the generated document free of anonymous recursive components: a
 * `z.lazy` cycle publishes as an unnamed `$ref` that no generated client can
 * name. The nesting is still returned in full — only its schema is open.
 */
export const v2ToolOutputSchema = z
  .object({
    type: z.string().describe('Value type of the output field.'),
    description: z.string().optional().describe('What the field holds.'),
    optional: z.boolean().optional().describe('Whether the field may be absent.'),
    nullable: z.boolean().optional().describe('Whether the field may be null.'),
    properties: z
      .record(
        z.string(),
        // untyped-response: a nested output field has the same open shape as this one
        z
          .unknown()
          .describe('Nested output field, in this same shape.')
      )
      .optional()
      .describe('Members of an object-typed output, keyed by field name.'),
    items: z
      .object({
        type: z.string().describe('Element value type.'),
        description: z.string().optional().describe('What an element holds.'),
        properties: z
          .record(
            z.string(),
            // untyped-response: a nested output field has the same open shape as this one
            z
              .unknown()
              .describe('Nested output field, in this same shape.')
          )
          .optional()
          .describe('Members of an object-typed element, keyed by field name.'),
      })
      .optional()
      .describe('Element shape of an array-typed output.'),
    fileConfig: z
      .object({
        mimeType: z.string().optional().describe('MIME type of the produced file.'),
        extension: z.string().optional().describe('File extension of the produced file.'),
      })
      .optional()
      .describe('File metadata for a file-typed output.'),
  })
  .meta({
    id: 'V2ToolOutput',
    title: 'Tool output',
    description: 'One declared output field of a built-in tool.',
  })
export type V2ToolOutput = z.output<typeof v2ToolOutputSchema>

const v2HostedApiKeySchema = z
  .enum(['always', 'conditional', 'none'])
  .describe(
    'Whether Sim supplies the API key on THIS deployment: `always`, `conditional` (only for some parameter combinations), or `none` (bring your own). Self-hosted deployments supply no hosted keys, so every tool reports `none` there regardless of what it declares.'
  )

const v2ToolOAuthSchema = z.object({
  required: z.boolean().describe('Whether the tool cannot run without an OAuth credential.'),
  provider: z.string().describe('OAuth service the credential must authenticate.'),
  requiredScopes: z.array(z.string()).optional().describe('Scopes the credential must carry.'),
})

/** Summary view of a built-in tool. */
export const v2ToolSummarySchema = z
  .object({
    id: z.string().describe('Registered tool identifier, including its version suffix.'),
    name: z.string().describe('Display name.'),
    description: z.string().describe('What the tool does.'),
    version: z.string().optional().describe('Tool version.'),
    hostedApiKey: v2HostedApiKeySchema,
    oauth: v2ToolOAuthSchema.optional().describe('OAuth requirement, when the tool has one.'),
  })
  .meta({
    id: 'V2ToolSummary',
    title: 'Tool summary',
    description: 'List view of a built-in tool: identity, auth, and key hosting.',
  })
export type V2ToolSummary = z.output<typeof v2ToolSummarySchema>

/** Detail view of a built-in tool. */
export const v2ToolDetailSchema = v2ToolSummarySchema
  .extend({
    params: z.record(z.string(), v2ToolParamSchema).describe('Parameters the tool accepts.'),
    outputs: z.record(z.string(), v2ToolOutputSchema).describe('Fields the tool produces.'),
  })
  .meta({
    id: 'V2ToolDetail',
    title: 'Tool',
    description: 'A built-in tool with its declared parameters and outputs.',
  })
export type V2ToolDetail = z.output<typeof v2ToolDetailSchema>

/**
 * Body for running one built-in tool.
 *
 * `workspaceId` rides in the body rather than the query, unlike the catalog
 * reads, because it decides which credentials and secrets the call may resolve
 * — the same placement every other v2 mutation uses.
 */
export const v2ExecuteToolBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe(
      'Workspace whose integration allowlist, credentials, and environment variables govern this call.'
    ),
    input: z
      .record(
        z.string(),
        z.unknown().describe('One argument value. Its shape is declared by the tool parameter.')
      )
      .default({})
      .describe(
        'Tool arguments keyed by published parameter IDs. For `user-only` parameters, a whole-value `{{VAR_NAME}}` reference resolves a workspace environment variable. Other values pass through unchanged.'
      ),
    credentialId: catalogIdSchema
      .optional()
      .describe(
        'Credential to authenticate with. Required when the tool declares an OAuth requirement; the workspace credentials list names the candidates.'
      ),
    timeoutSeconds: z
      .number()
      .int('timeoutSeconds must be a whole number')
      .min(1, 'timeoutSeconds must be at least 1')
      .max(
        V2_TOOL_EXECUTION_MAX_TIMEOUT_SECONDS,
        `timeoutSeconds cannot exceed ${V2_TOOL_EXECUTION_MAX_TIMEOUT_SECONDS}`
      )
      .optional()
      .describe('How long to wait for the tool before abandoning the call.'),
  })
  .strict()
export type V2ExecuteToolBody = z.input<typeof v2ExecuteToolBodySchema>

/**
 * Outcome of one tool call.
 *
 * A tool that ran and refused is a `200` carrying `status: "failed"`, not an
 * error envelope: the call itself succeeded, and the refusal is the tool's
 * answer. The envelope is reserved for failures of this API — authorization,
 * validation, an unknown tool.
 */
export const v2ToolExecutionSchema = z
  .object({
    toolId: z
      .string()
      .describe(
        'Tool that ran. An unversioned name resolves to the newest version visible in the workspace, so this can differ from the id in the path.'
      ),
    status: z
      .enum(['succeeded', 'failed'])
      .describe('Whether the tool reported success. A failed tool call is still a 200.'),
    // untyped-response: every tool declares its own output shape, already published by GET /api/v2/tools/{toolId}
    output: z.unknown().describe('Whatever the tool produced, shaped by its declared outputs.'),
    error: z
      .object({ message: z.string().describe('Why the tool call did not succeed.') })
      .nullable()
      .describe('Populated only when `status` is `failed`.'),
  })
  .meta({
    id: 'V2ToolExecution',
    title: 'Tool execution',
    description: 'The result of running one built-in tool.',
  })
export type V2ToolExecution = z.output<typeof v2ToolExecutionSchema>

/**
 * One value an operation needs.
 *
 * An operation's inputs come from two places — the tool's own declared params
 * and the block's operation-scoped input definitions — and the two carry
 * different structure keys (`items` versus `schema`). This is one schema with
 * both rather than a union of the two, because a union of two open object
 * shapes resolves to whichever member matches first and silently strips the key
 * that distinguished them: a block input's `schema` disappeared into the tool
 * param member, which validated fine and published an incomplete field.
 */
const v2OperationInputSchema = z
  .object({
    type: z.string().describe('Value type.'),
    required: z.boolean().optional().describe('Whether the value must be supplied.'),
    visibility: z
      .string()
      .optional()
      .describe('Who may supply the value: `user-or-llm`, `user-only`, `llm-only`, or `hidden`.'),
    description: z.string().optional().describe('What the value means.'),
    default: z.unknown().optional().describe('Value used when this input is omitted.'),
    // untyped-response: tool param JSON Schema is provider-defined and arbitrarily nested
    items: z
      .unknown()
      .optional()
      .describe('JSON-Schema-shaped constraints declared by the tool parameter.'),
    // untyped-response: block input JSON Schema is authored per block and arbitrarily nested
    schema: z
      .unknown()
      .optional()
      .describe('JSON-Schema-shaped structure declared by the block input.'),
  })
  .meta({
    id: 'V2OperationInput',
    title: 'Operation input',
    description: 'One value a block operation needs, from its tool or its block-level inputs.',
  })

const v2BlockOperationSchema = z.object({
  toolId: z.string().optional().describe('Built-in tool that performs this operation.'),
  toolName: z.string().optional().describe('Display name of that tool.'),
  description: z.string().optional().describe('What the operation does.'),
  inputs: z
    .record(z.string(), v2OperationInputSchema)
    .describe(
      'Values this operation needs, excluding the ones the block supplies from its own block-level inputs.'
    ),
  outputs: z.record(z.string(), v2ToolOutputSchema).describe('Fields the operation produces.'),
  inputSchema: z
    .array(v2BlockFieldSchema)
    .describe('Configuration fields that appear when this operation is selected.'),
})

const v2BlockTriggerSchema = z.object({
  id: z.string().describe('Trigger identifier.'),
  outputs: z
    .record(z.string(), v2BlockOutputSchema)
    .describe('Top-level fields the trigger event delivers.'),
  configFields: z
    .record(
      z.string(),
      z.object({
        type: z.string().describe('Editor control the field renders as.'),
        required: z.boolean().describe('Whether a value must be supplied.'),
        title: z.string().optional().describe('Human-readable label.'),
        description: z.string().optional().describe('Authored explanation of the field.'),
        placeholder: z.string().optional().describe('Placeholder shown in the editor.'),
        default: z.unknown().optional().describe('Value used when the field is left unset.'),
        options: z
          .array(
            z.object({
              id: z.string().describe('Value stored when this option is selected.'),
              label: z.string().describe('Human-readable option label.'),
            })
          )
          .optional()
          .describe('Selectable options.'),
        condition: v2CatalogConditionSchema
          .optional()
          .describe('Condition under which the field applies.'),
      })
    )
    .describe('Fields that configure the trigger, keyed by field id.'),
})

/** Detail view of a block: the summary plus everything needed to configure one. */
export const v2BlockDetailSchema = v2BlockSummarySchema
  .extend({
    bestPractices: z
      .string()
      .optional()
      .describe('Authored guidance on using the block correctly.'),
    inputSchema: z
      .array(v2BlockFieldSchema)
      .describe('Configuration fields that apply regardless of the selected operation.'),
    operationInputSchema: z
      .record(z.string(), z.array(v2BlockFieldSchema))
      .describe('Configuration fields keyed by the operation that reveals them.'),
    inputDefinitions: z
      .record(z.string(), v2BlockInputDefinitionSchema)
      .describe('Block-level input definitions, keyed by parameter name.'),
    operations: z
      .record(z.string(), v2BlockOperationSchema)
      .describe('Operations the block exposes, keyed by operation id.'),
    tools: z
      .array(v2ToolDetailSchema)
      .describe('Every built-in tool the block can run, with parameters and outputs.'),
    triggers: z.array(v2BlockTriggerSchema).describe('Triggers the block can run on.'),
    outputs: z.record(z.string(), v2BlockOutputSchema).describe('Fields the block produces.'),
  })
  .meta({
    id: 'V2BlockDetail',
    title: 'Block',
    description: 'A block with its configuration fields, operations, tools, and triggers.',
  })
export type V2BlockDetail = z.output<typeof v2BlockDetailSchema>

/** One field of a connector's `sourceConfig`. */
export const v2ConnectorConfigFieldSchema = z
  .object({
    id: z.string().describe('Field identifier.'),
    title: z.string().describe('Human-readable label.'),
    type: z
      .enum(['short-input', 'dropdown', 'selector'])
      .describe(
        'Control the field renders as. A `selector` fetches its options from the connected account.'
      ),
    placeholder: z.string().optional().describe('Placeholder shown in the editor.'),
    required: z.boolean().optional().describe('Whether a value must be supplied.'),
    description: z.string().optional().describe('Authored explanation of the field.'),
    options: z
      .array(
        z.object({
          id: z.string().describe('Value stored when this option is selected.'),
          label: z.string().describe('Human-readable option label.'),
        })
      )
      .optional()
      .describe('Static options, for a `dropdown` field.'),
    selectorKey: z
      .string()
      .optional()
      .describe(
        'Names the picker a `selector` field renders. Its options are fetched per workspace.'
      ),
    mimeType: z.string().optional().describe('MIME type filter applied to the picker.'),
    dependsOn: catalogDependsOnSchema
      .optional()
      .describe('Sibling fields this field is cleared by when they change.'),
    mode: z
      .enum(['basic', 'advanced'])
      .optional()
      .describe(
        'Which half of a canonical pair this field is: `basic` is the picker, `advanced` the manual entry.'
      ),
    canonicalParamId: z
      .string()
      .optional()
      .describe(
        'Shared `sourceConfig` key for a picker/manual-entry pair. Send exactly one of the pair, keyed by this value rather than by the field’s own `id`.'
      ),
    multi: z
      .boolean()
      .optional()
      .describe(
        'When true the stored `sourceConfig` value is a `string[]`, not a `string`: a `selector` renders a multi-select picker and a `short-input` accepts a comma-separated list.'
      ),
  })
  .meta({
    id: 'V2ConnectorConfigField',
    title: 'Connector config field',
    description: 'One field of a knowledge-base connector’s source configuration.',
  })
export type V2ConnectorConfigField = z.output<typeof v2ConnectorConfigFieldSchema>

/** A knowledge-base connector type. */
export const v2ConnectorTypeSchema = z
  .object({
    connectorType: z
      .string()
      .describe('Exact identifier to send when creating a connector of this type.'),
    name: z.string().describe('Display name.'),
    description: z.string().describe('What the connector syncs.'),
    version: z.string().describe('Connector version.'),
    auth: z
      .discriminatedUnion('mode', [
        z.object({
          mode: z.literal('oauth').describe('Authenticates with an OAuth credential.'),
          provider: z.string().describe('OAuth service the credential must authenticate.'),
          requiredScopes: z
            .array(z.string())
            .optional()
            .describe('Scopes the credential must carry.'),
        }),
        z.object({
          mode: z.literal('apiKey').describe('Authenticates with a stored API key.'),
          label: z.string().optional().describe('Label shown above the key field.'),
          placeholder: z.string().optional().describe('Placeholder shown in the key field.'),
          optional: z
            .boolean()
            .describe(
              'Whether the key may be left blank, for a source reachable without authentication.'
            ),
        }),
      ])
      .describe('How the connector authenticates against its source.'),
    configFields: z
      .array(v2ConnectorConfigFieldSchema)
      .describe('Fields that make up the connector’s `sourceConfig`.'),
    supportsIncrementalSync: z
      .boolean()
      .describe('Whether syncs after the first fetch only what changed.'),
    tagDefinitions: z
      .array(
        z.object({
          id: z.string().describe('Semantic tag identifier the connector populates.'),
          displayName: z.string().describe('Human-readable tag name.'),
          fieldType: z
            .enum(['text', 'number', 'date', 'boolean'])
            .describe('Value type, which decides the tag slot pool it draws from.'),
        })
      )
      .describe('Tags this connector writes onto the documents it syncs.'),
  })
  .meta({
    id: 'V2ConnectorType',
    title: 'Connector type',
    description: 'A knowledge-base connector type and the configuration it accepts.',
  })
export type V2ConnectorType = z.output<typeof v2ConnectorTypeSchema>

export const v2BlockSortFields = ['id', 'name', 'category'] as const
export const v2ToolSortFields = ['id', 'name'] as const

export const v2ListBlocksQuerySchema = catalogWorkspaceQuerySchema
  .extend({
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against the block id, name, and description.'
    ),
    category: z
      .enum(['blocks', 'tools', 'triggers'])
      .optional()
      .describe('Restrict to one toolbar category.'),
    capability: z
      .enum(['trigger'])
      .optional()
      .describe(
        'Restrict to blocks that can start a workflow — the `triggers` category, blocks declaring `triggerAllowed`, and blocks with trigger-mode fields.'
      ),
    source: z
      .enum(['builtin', 'custom'])
      .optional()
      .describe("Restrict to built-in blocks or this workspace's deployed custom blocks."),
    ...v2SortFields(v2BlockSortFields, { sortBy: 'id', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum blocks to return per page.' }),
  })
  .strict()
export type V2ListBlocksQuery = z.output<typeof v2ListBlocksQuerySchema>

export const v2ListToolsQuerySchema = catalogWorkspaceQuerySchema
  .extend({
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against the tool id, name, and description.'
    ),
    hostedApiKey: z
      .enum(['always', 'conditional', 'none'])
      .optional()
      .describe('Restrict to tools by how their API key is supplied.'),
    oauthProvider: z
      .string()
      .trim()
      .min(1, 'oauthProvider cannot be empty')
      .max(255, 'oauthProvider must be at most 255 characters')
      .optional()
      .describe('Restrict to tools that authenticate against this OAuth service.'),
    ...v2SortFields(v2ToolSortFields, { sortBy: 'id', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum tools to return per page.' }),
  })
  .strict()
export type V2ListToolsQuery = z.output<typeof v2ListToolsQuerySchema>

export const v2GetBlockParamsSchema = z.object({
  blockId: catalogIdSchema.describe(
    'Block type identifier. An unversioned base type resolves to the newest version, and the response echoes the resolved id.'
  ),
})
export type V2GetBlockParams = z.output<typeof v2GetBlockParamsSchema>

export const v2GetToolParamsSchema = z.object({
  toolId: catalogIdSchema.describe(
    'Tool identifier. An unversioned name resolves to the newest version, and the response echoes the resolved id.'
  ),
})
export type V2GetToolParams = z.output<typeof v2GetToolParamsSchema>

export const v2ListConnectorTypesQuerySchema = catalogWorkspaceQuerySchema
  .extend({
    search: v2SearchSchema.describe('Case-insensitive substring match against the connector name.'),
  })
  .strict()
export type V2ListConnectorTypesQuery = z.output<typeof v2ListConnectorTypesQuerySchema>

/**
 * Block list, paginated by an opaque offset cursor rather than the keyset most
 * v2 lists use — the same case as `GET /api/v2/skills`. The sequence merges the
 * static code registry with the workspace’s deployed custom blocks, filters it
 * against the caller’s visibility, and sorts it in memory, so there is no
 * ordered SQL read for a keyset predicate to act on.
 */
export const v2ListBlocksContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/blocks',
  query: v2ListBlocksQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2BlockSummarySchema) },
})

export const v2GetBlockContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/blocks/[blockId]',
  params: v2GetBlockParamsSchema,
  query: catalogWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2BlockDetailSchema) },
})

/**
 * Tool list, paginated by the same offset cursor and for the same reason: the
 * catalog is a code-defined id set narrowed against the caller’s workspace
 * visibility entirely in memory.
 */
export const v2ListToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tools',
  query: v2ListToolsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2ToolSummarySchema) },
})

export const v2GetToolContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tools/[toolId]',
  params: v2GetToolParamsSchema,
  query: catalogWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ToolDetailSchema) },
})

/**
 * Runs one built-in tool and returns what it produced.
 *
 * The verb the catalog was missing: `GET /api/v2/tools/{toolId}` already
 * publishes the parameters, and this is how a caller supplies them. Sim
 * resolves the credential, injects a hosted API key where it supplies one, and
 * substitutes environment-variable references, so the request carries arguments
 * rather than secrets.
 */
export const v2ExecuteToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tools/[toolId]/execute',
  params: v2GetToolParamsSchema,
  query: noInputSchema,
  body: v2ExecuteToolBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ToolExecutionSchema) },
})

export const v2ListConnectorTypesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/connector-types',
  query: v2ListConnectorTypesQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ConnectorTypeSchema, { paged: false }),
  },
})
