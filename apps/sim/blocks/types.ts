import type { JSX, SVGProps } from 'react'
import type { ToolResponse } from '@/tools/types'

// Basic types
export type BlockIcon = (props: SVGProps<SVGSVGElement>) => JSX.Element
export type ParamType = 'string' | 'number' | 'boolean' | 'json'
export type PrimitiveValueType = 'string' | 'number' | 'boolean' | 'json' | 'any'

// Block classification
export type BlockCategory = 'blocks' | 'tools'

// SubBlock types
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
  | 'condition-input' // Conditional logic
  | 'eval-input' // Evaluation input
  | 'date-input' // Date input
  | 'time-input' // Time input
  | 'oauth-input' // OAuth credential selector
  | 'webhook-config' // Webhook configuration
  | 'schedule-config' // Schedule status and information
  | 'file-selector' // File selector for Google Drive, etc.
  | 'project-selector' // Project selector for Jira, Discord, etc.
  | 'channel-selector' // Channel selector for Slack, Discord, etc.
  | 'folder-selector' // Folder selector for Gmail, etc.
  | 'knowledge-base-selector' // Knowledge base selector
  | 'document-selector' // Document selector for knowledge bases
  | 'input-format' // Input structure format
  | 'response-format' // Response structure format
  | 'file-upload' // File uploader

// Component width setting
export type SubBlockLayout = 'full' | 'half'

// Tool result extraction
export type ExtractToolOutput<T> = T extends ToolResponse ? T['output'] : never

// Convert tool output to types
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

// Block output definition
export type BlockOutput =
  | PrimitiveValueType
  | { [key: string]: PrimitiveValueType | Record<string, any> }

// Parameter validation rules
export interface ParamConfig {
  type: ParamType
  required: boolean
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

// SubBlock configuration
export interface SubBlockConfig {
  id: string
  title?: string
  type: SubBlockType
  layout?: SubBlockLayout
  mode?: 'basic' | 'advanced' | 'both' // Default is 'both' if not specified
  options?:
    | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }[]
    | (() => { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }[])
  min?: number
  max?: number
  columns?: string[]
  placeholder?: string
  password?: boolean
  connectionDroppable?: boolean
  hidden?: boolean
  description?: string
  value?: (params: Record<string, any>) => string
  condition?: {
    field: string
    value: string | number | boolean | Array<string | number | boolean>
    not?: boolean
    and?: {
      field: string
      value: string | number | boolean | Array<string | number | boolean> | undefined
      not?: boolean
    }
  }
  // Props specific to 'code' sub-block type
  language?: 'javascript' | 'json'
  generationType?: 'javascript-function-body' | 'json-schema' | 'json-object'
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
}

// Main block definition
export interface BlockConfig<T extends ToolResponse = ToolResponse> {
  type: string
  name: string
  description: string
  category: BlockCategory
  longDescription?: string
  docsLink?: string
  bgColor: string
  icon: BlockIcon
  subBlocks: SubBlockConfig[]
  tools: {
    access: string[]
    config?: {
      tool: (params: Record<string, any>) => string
      params?: (params: Record<string, any>) => Record<string, any>
    }
  }
  inputs: Record<string, ParamConfig>
  outputs: ToolOutputToValueType<ExtractToolOutput<T>> & {
    visualization?: {
      type: 'image'
      url: string
    }
  }
  hideFromToolbar?: boolean
}

// Output configuration rules
export interface OutputConfig {
  type: BlockOutput
}
