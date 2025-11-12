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
  | 'files'
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
  | 'checkbox-list' // Multiple selection
  | 'grouped-checkbox-list' // Grouped, scrollable checkbox list with select all
  | 'condition-input' // Conditional logic
  | 'eval-input' // Evaluation input
  | 'time-input' // Time input
  | 'oauth-input' // OAuth credential selector
  | 'webhook-config' // Webhook configuration
  | 'schedule-save' // Schedule save button with status display
  | 'file-selector' // File selector for Google Drive, etc.
  | 'project-selector' // Project selector for Jira, Discord, etc.
  | 'channel-selector' // Channel selector for Slack, Discord, etc.
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
  | 'trigger-save' // Trigger save button with validation
  | 'file-upload' // File uploader
  | 'input-mapping' // Map parent variables to child workflow input schema
  | 'variables-input' // Variable assignments for updating workflow variables
  | 'text' // Read-only text display

/**
 * Selector types that require display name hydration
 * These show IDs/keys that need to be resolved to human-readable names
 */
export const SELECTOR_TYPES_HYDRATION_REQUIRED: SubBlockType[] = [
  'oauth-input',
  'channel-selector',
  'file-selector',
  'folder-selector',
  'project-selector',
  'knowledge-base-selector',
  'document-selector',
  'variables-input',
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

export type OutputFieldDefinition =
  | PrimitiveValueType
  | { type: PrimitiveValueType; description?: string }

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
  required?: boolean
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
    | (() => {
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
  language?: 'javascript' | 'json'
  generationType?: GenerationType
  collapsible?: boolean // Whether the code block can be collapsed
  defaultCollapsed?: boolean // Whether the code block is collapsed by default
  // OAuth specific properties
  provider?: string
  serviceId?: string
  requiredScopes?: string[]
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
  // Wand configuration for AI assistance
  wandConfig?: {
    enabled: boolean
    prompt: string // Custom prompt template for this subblock
    generationType?: GenerationType // Optional custom generation type
    placeholder?: string // Custom placeholder for the prompt input
    maintainHistory?: boolean // Whether to maintain conversation history
  }
  // Declarative dependency hints for cross-field clearing or invalidation
  // Example: dependsOn: ['credential'] means this field should be cleared when credential changes
  dependsOn?: string[]
  // Copyable-text specific: Use webhook URL from webhook management hook
  useWebhookUrl?: boolean
  // Trigger-save specific: The trigger ID for validation and saving
  triggerId?: string
  // Dropdown specific: Function to fetch options dynamically (for multi-select or single-select)
  fetchOptions?: (
    blockId: string,
    subBlockId: string
  ) => Promise<Array<{ label: string; id: string }>>
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
