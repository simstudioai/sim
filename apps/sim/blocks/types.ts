import type { JSX, SVGProps } from 'react'
import type { ToolResponse } from '@/tools/types'

export type BlockIcon = (props: SVGProps<SVGSVGElement>) => JSX.Element
export type ParamType = 'string' | 'number' | 'boolean' | 'json' | 'array'
export type PrimitiveValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'array'
  | 'file'
  | 'file[]'
  | 'any'

export type BlockCategory = 'blocks' | 'tools' | 'triggers'

// Authentication modes for sub-blocks and summaries
export enum AuthMode {
  OAuth = 'oauth',
  ApiKey = 'api_key',
  BotToken = 'bot_token',
}

export type GenerationType =
  | 'javascript-function-body'
  | 'typescript-function-body'
  | 'json-schema'
  | 'json-object'
  | 'system-prompt'
  | 'custom-tool-schema'
  | 'sql-query'
  | 'postgrest'
  | 'mongodb-filter'
  | 'mongodb-pipeline'
  | 'mongodb-sort'
  | 'mongodb-documents'
  | 'mongodb-update'
  | 'neo4j-cypher'
  | 'neo4j-parameters'
  | 'timestamp'
  | 'timezone'

export type SubBlockType =
  | 'short-input' // Single line input
  | 'long-input' // Multi-line input
  | 'dropdown' // Select menu
  | 'combobox' // Searchable dropdown with text input
  | 'slider' // Range input
  | 'table' // Grid layout
  | 'code' // Code editor
  | 'switch' // Toggle button
  | 'tool-input' // Tool configuration
  | 'skill-input' // Skill selection for agent blocks
  | 'checkbox-list' // Multiple selection
  | 'grouped-checkbox-list' // Grouped, scrollable checkbox list with select all
  | 'condition-input' // Conditional logic
  | 'eval-input' // Evaluation input
  | 'time-input' // Time input
  | 'oauth-input' // OAuth credential selector
  | 'webhook-config' // Webhook configuration
  | 'schedule-info' // Schedule status display (next run, last ran, failure badge)
  | 'file-selector' // File selector for Google Drive, etc.
  | 'sheet-selector' // Sheet/tab selector for Google Sheets, Microsoft Excel
  | 'project-selector' // Project selector for Jira, Discord, etc.
  | 'channel-selector' // Channel selector for Slack, Discord, etc.
  | 'user-selector' // User selector for Slack, etc.
  | 'folder-selector' // Folder selector for Gmail, etc.
  | 'knowledge-base-selector' // Knowledge base selector
  | 'knowledge-tag-filters' // Multiple tag filters for knowledge bases
  | 'document-selector' // Document selector for knowledge bases
  | 'document-tag-entry' // Document tag entry for creating documents
  | 'mcp-server-selector' // MCP server selector
  | 'mcp-tool-selector' // MCP tool selector
  | 'mcp-dynamic-args' // MCP dynamic arguments based on tool schema
  | 'input-format' // Input structure format
  | 'response-format' // Response structure format
  /**
   * @deprecated Legacy trigger save subblock type.
   */
  | 'trigger-save' // Trigger save button with validation
  | 'file-upload' // File uploader
  | 'input-mapping' // Map parent variables to child workflow input schema
  | 'variables-input' // Variable assignments for updating workflow variables
  | 'messages-input' // Multiple message inputs with role and content for LLM message history
  | 'workflow-selector' // Workflow selector for agent tools
  | 'workflow-input-mapper' // Dynamic workflow input mapper based on selected workflow
  | 'text' // Read-only text display
  | 'router-input' // Router route definitions with descriptions

/**
 * Selector types that require display name hydration
 * These show IDs/keys that need to be resolved to human-readable names
 */
export const SELECTOR_TYPES_HYDRATION_REQUIRED: SubBlockType[] = [
  'oauth-input',
  'channel-selector',
  'user-selector',
  'file-selector',
  'sheet-selector',
  'folder-selector',
  'project-selector',
  'knowledge-base-selector',
  'workflow-selector',
  'document-selector',
  'variables-input',
  'mcp-server-selector',
  'mcp-tool-selector',
] as const

export type ExtractToolOutput<T> = T extends ToolResponse ? T['output'] : never

export type ToolOutputToValueType<T> = T extends Record<string, any>
  ? {
      [K in keyof T]: T[K] extends string
        ? 'string'
        : T[K] extends number
          ? 'number'
          : T[K] extends boolean
            ? 'boolean'
            : T[K] extends object
              ? 'json'
              : 'any'
    }
  : never

export type BlockOutput =
  | PrimitiveValueType
  | { [key: string]: PrimitiveValueType | Record<string, any> }

/**
 * Condition for showing an output field.
 * Uses the same pattern as SubBlockConfig.condition
 */
export interface OutputCondition {
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
      /**
       * Optional condition for when this output should be shown.
       * If not specified, the output is always shown.
       * Uses the same condition format as subBlocks.
       */
      condition?: OutputCondition
      /**
       * If true, this output is hidden from display in the tag dropdown and logs,
       * but still available for resolution and execution.
       */
      hiddenFromDisplay?: boolean
    }

export function isHiddenFromDisplay(def: unknown): boolean {
  return Boolean(
    def && typeof def === 'object' && 'hiddenFromDisplay' in def && def.hiddenFromDisplay
  )
}

export interface ParamConfig {
  type: ParamType
  description?: string
  schema?: {
    type: string
    properties: Record<string, any>
    required?: string[]
    additionalProperties?: boolean
    items?: {
      type: string
      properties?: Record<string, any>
      required?: string[]
      additionalProperties?: boolean
    }
  }
}

export interface SubBlockConfig {
  id: string
  title?: string
  type: SubBlockType
  mode?: 'basic' | 'advanced' | 'both' | 'trigger' // Default is 'both' if not specified. 'trigger' means only shown in trigger mode
  canonicalParamId?: string
  required?:
    | boolean
    | {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      }
    | ((values?: Record<string, unknown>) => {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      })
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  options?:
    | {
        label: string
        id: string
        icon?: React.ComponentType<{ className?: string }>
        group?: string
      }[]
    | (() => {
        label: string
        id: string
        icon?: React.ComponentType<{ className?: string }>
        group?: string
      }[])
  min?: number
  max?: number
  columns?: string[]
  placeholder?: string
  password?: boolean
  readOnly?: boolean
  showCopyButton?: boolean
  connectionDroppable?: boolean
  hidden?: boolean
  hideFromPreview?: boolean // Hide this subblock from the workflow block preview
  requiresFeature?: string // Environment variable name that must be truthy for this subblock to be visible
  description?: string
  tooltip?: string // Tooltip text displayed via info icon next to the title
  value?: (params: Record<string, any>) => string
  grouped?: boolean
  scrollable?: boolean
  maxHeight?: number
  selectAllOption?: boolean
  condition?:
    | {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      }
    | ((values?: Record<string, unknown>) => {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      })
  // Props specific to 'code' sub-block type
  language?: 'javascript' | 'json' | 'python'
  generationType?: GenerationType
  collapsible?: boolean // Whether the code block can be collapsed
  defaultCollapsed?: boolean // Whether the code block is collapsed by default
  // OAuth specific properties - serviceId is the canonical identifier for OAuth services
  serviceId?: string
  requiredScopes?: string[]
  // Whether this credential selector supports credential sets (for trigger blocks)
  supportsCredentialSets?: boolean
  // File selector specific properties
  mimeType?: string
  // File upload specific properties
  acceptedTypes?: string
  multiple?: boolean
  maxSize?: number
  // Slider-specific properties
  step?: number
  integer?: boolean
  // Long input specific properties
  rows?: number
  // Multi-select functionality
  multiSelect?: boolean
  // Combobox specific: Enable search input in dropdown
  searchable?: boolean
  // Wand configuration for AI assistance
  wandConfig?: {
    enabled: boolean
    prompt: string // Custom prompt template for this subblock
    generationType?: GenerationType // Optional custom generation type
    placeholder?: string // Custom placeholder for the prompt input
    maintainHistory?: boolean // Whether to maintain conversation history
  }
  /**
   * Declarative dependency hints for cross-field clearing or invalidation.
   * Supports two formats:
   * - Simple array: `['credential']` - all fields must have values (AND logic)
   * - Object with all/any: `{ all: ['authMethod'], any: ['credential', 'botToken'] }`
   *   - `all`: all listed fields must have values (AND logic)
   *   - `any`: at least one field must have a value (OR logic)
   */
  dependsOn?: string[] | { all?: string[]; any?: string[] }
  // Copyable-text specific: Use webhook URL from webhook management hook
  useWebhookUrl?: boolean
  // Trigger-save specific: The trigger ID for validation and saving
  triggerId?: string
  // Dropdown/Combobox: Function to fetch options dynamically
  // Works with both 'dropdown' (select-only) and 'combobox' (editable with expression support)
  fetchOptions?: (
    blockId: string,
    subBlockId: string
  ) => Promise<Array<{ label: string; id: string }>>
  // Dropdown/Combobox: Function to fetch a single option's label by ID (for hydration)
  // Called when component mounts with a stored value to display the correct label before options load
  fetchOptionById?: (
    blockId: string,
    subBlockId: string,
    optionId: string
  ) => Promise<{ label: string; id: string } | null>
}

export interface BlockConfig<T extends ToolResponse = ToolResponse> {
  type: string
  name: string
  description: string
  category: BlockCategory
  longDescription?: string
  bestPractices?: string
  docsLink?: string
  bgColor: string
  icon: BlockIcon
  subBlocks: SubBlockConfig[]
  triggerAllowed?: boolean
  authMode?: AuthMode
  singleInstance?: boolean
  tools: {
    access: string[]
    config?: {
      tool: (params: Record<string, any>) => string
      params?: (params: Record<string, any>) => Record<string, any>
    }
  }
  inputs: Record<string, ParamConfig>
  outputs: Record<string, OutputFieldDefinition> & {
    visualization?: {
      type: 'image'
      url: string
    }
  }
  hideFromToolbar?: boolean
  triggers?: {
    enabled: boolean
    available: string[] // List of trigger IDs this block supports
  }
}

export interface OutputConfig {
  type: BlockOutput
}
