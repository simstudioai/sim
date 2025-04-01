import type { SVGProps } from 'react'
import type { JSX } from 'react'
import { ToolResponse } from '@/tools/types'

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
  | 'folder-selector' // Folder selector for Gmail, etc.
  | 'input-format' // Input structure format
  | 'file-upload' // File uploader

// Component width setting
export type SubBlockLayout = 'full' | 'half'

// Tool result extraction
export type ExtractToolOutput<T> = T extends ToolResponse ? T['output'] : never

// Convert tool output to types
export type ToolOutputToValueType<T> =
  T extends Record<string, any>
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
  requiredForToolCall?: boolean
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
  options?:
    | string[]
    | { label: string; id: string }[]
    | (() => string[] | { label: string; id: string }[])
  min?: number
  max?: number
  columns?: string[]
  placeholder?: string
  password?: boolean
  connectionDroppable?: boolean
  hidden?: boolean
  value?: (params: Record<string, any>) => string
  condition?: {
    field: string
    value: string | number | boolean | Array<string | number | boolean>
    and?: {
      field: string
      value: string | number | boolean | Array<string | number | boolean>
    }
  }
  // OAuth specific properties
  provider?: string
  serviceId?: string
  requiredScopes?: string[]
  // File selector specific properties
  mimeType?: string
  // File upload specific properties
  acceptedTypes?: string
  multiple?: boolean
}

// Main block definition
export interface BlockConfig<T extends ToolResponse = ToolResponse> {
  type: string
  name: string
  description: string
  category: BlockCategory
  longDescription?: string
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
  outputs: {
    response: {
      type: ToolOutputToValueType<ExtractToolOutput<T>>
      dependsOn?: {
        subBlockId: string
        condition: {
          whenEmpty: ToolOutputToValueType<ExtractToolOutput<T>>
          whenFilled: 'json'
        }
      }
      visualization?: {
        type: 'image'
        url: string
      }
    }
  }
}

// Output configuration rules
export interface OutputConfig {
  type: BlockOutput
  dependsOn?: {
    subBlockId: string
    condition: {
      whenEmpty: BlockOutput
      whenFilled: BlockOutput
    }
  }
}
