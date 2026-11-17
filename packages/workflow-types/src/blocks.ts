export type PrimitiveValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'array'
  | 'file'
  | 'file[]'
  | 'any'

export type SubBlockType =
  | 'short-input'
  | 'long-input'
  | 'dropdown'
  | 'combobox'
  | 'slider'
  | 'table'
  | 'code'
  | 'switch'
  | 'tool-input'
  | 'skill-input'
  | 'checkbox-list'
  | 'grouped-checkbox-list'
  | 'condition-input'
  | 'eval-input'
  | 'time-input'
  | 'oauth-input'
  | 'webhook-config'
  | 'schedule-info'
  | 'file-selector'
  | 'sheet-selector'
  | 'project-selector'
  | 'channel-selector'
  | 'user-selector'
  | 'folder-selector'
  | 'knowledge-base-selector'
  | 'knowledge-tag-filters'
  | 'document-selector'
  | 'document-tag-entry'
  | 'mcp-server-selector'
  | 'mcp-tool-selector'
  | 'mcp-dynamic-args'
  | 'input-format'
  | 'response-format'
  | 'filter-builder'
  | 'sort-builder'
  | 'file-upload'
  | 'input-mapping'
  | 'variables-input'
  | 'messages-input'
  | 'workflow-selector'
  | 'workflow-output-selector'
  | 'workflow-input-mapper'
  | 'text'
  | 'router-input'
  | 'table-selector'
  | 'model-fallback-list'
  | 'column-selector'
  | 'modal'

export interface OutputCondition {
  /** Keep the output selectable when the compared value is resolved at execution time. */
  allowReference?: boolean
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
  and?: {
    field: string
    value:
      | string
      | number
      | boolean
      | Array<string | number | boolean | undefined | null>
      | undefined
      | null
    not?: boolean
  }
}

export type OutputFieldDefinition =
  | PrimitiveValueType
  | {
      type: PrimitiveValueType
      description?: string
      condition?: OutputCondition
      hiddenFromDisplay?: boolean
    }

export function isHiddenFromDisplay(def: unknown): boolean {
  return Boolean(
    def && typeof def === 'object' && 'hiddenFromDisplay' in def && def.hiddenFromDisplay
  )
}

/**
 * Agent fields the serializer forwards even with no subBlock config, so the executor can migrate
 * workflows saved before the agent block's messages input.
 */
export const LEGACY_AGENT_FIELDS: ReadonlySet<string> = new Set([
  'systemPrompt',
  'userPrompt',
  'memories',
])

/**
 * A custom block's params that carry its own wiring rather than a mapped Start input. Everything
 * else on the block is collected into the child `inputMapping`, and a custom block declares inputs
 * exactly when it has a subBlock outside this set.
 */
export const CUSTOM_BLOCK_RESERVED_PARAMS: ReadonlySet<string> = new Set([
  'workflowId',
  'inputMapping',
  'triggerMode',
  'advancedMode',
])

/**
 * Trigger subBlocks that are UI infrastructure (credentials, instructions, the webhook URL, sample
 * payloads, setup scripts, schedule status) rather than configuration: never aggregated into
 * `triggerConfig`, copied into a webhook provider config, or validated as user fields.
 */
export const SYSTEM_SUBBLOCK_IDS: readonly string[] = [
  'triggerCredentials',
  'triggerInstructions',
  'webhookUrlDisplay',
  'samplePayload',
  'setupScript',
  'scheduleInfo',
]
