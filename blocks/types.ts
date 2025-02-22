import type { SVGProps } from 'react'
import type { JSX } from 'react'
import { ToolResponse } from '@/tools/types'

// Basic types
export type BlockIcon = (props: SVGProps<SVGSVGElement>) => JSX.Element // Function returning an icon component using SVG properties
export type ParamType = 'string' | 'number' | 'boolean' | 'json' // Supported parameter types
export type PrimitiveValueType = 'string' | 'number' | 'boolean' | 'json' | 'any' // Allowed primitive type outputs

// Block classification
export type BlockCategory = 'blocks' | 'tools' // Determines if a block is a generic block or a tool

// SubBlock types (defining UI control types)
export type SubBlockType =
  | 'short-input' // Single-line text input
  | 'long-input' // Multi-line text input
  | 'dropdown' // Dropdown select menu
  | 'slider' // Range slider input
  | 'table' // Table or grid layout
  | 'code' // Code editor interface
  | 'switch' // Toggle switch (boolean)
  | 'tool-input' // Input for tool-specific configurations
  | 'checkbox-list' // Multiple checkboxes for selection
  | 'condition-input' // Input for setting conditions/logic
  | 'eval-input' // Input intended for evaluation expressions
  | 'date-input' // Date picker input
  | 'time-input' // Time picker input

// Component width settings for sub-blocks
export type SubBlockLayout = 'full' | 'half' // Indicates if a sub-block spans full or half width

// Extract the output defined in a ToolResponse if applicable; otherwise never
export type ExtractToolOutput<T> = T extends ToolResponse ? T['output'] : never

// Convert a tool's output to a mapping of string literal types based on the actual output
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

// Block output definition; can be a primitive or a mapped object
export type BlockOutput =
  | PrimitiveValueType // For simple outputs
  | { [key: string]: PrimitiveValueType | Record<string, any> } // For structured outputs

// Configuration for validating a parameter provided to a block
export interface ParamConfig {
  type: ParamType // The type of the parameter (string, number, boolean, or json)
  required: boolean // Whether this parameter is required
  description?: string // Optional explanation of the parameter
  schema?: {
    // JSON schema for validating complex or structured inputs
    type: string // Schema type such as 'object' or 'array'
    properties: Record<string, any> // Defines properties and their constraints within an object
    required?: string[] // Names of required properties within the schema
    additionalProperties?: boolean // Whether additional properties not defined in the schema are allowed
    items?: {
      // Schema definition if the parameter is an array
      type: string // Type of each individual item in the array
      properties?: Record<string, any> // Properties of each array item if it is an object
      required?: string[] // Required keys for each item in the array
      additionalProperties?: boolean // Allow properties beyond those defined in the schema
    }
  }
}

// Configuration for an individual sub-block (UI control) within a block
export interface SubBlockConfig {
  id: string // Unique identifier for the sub-block
  title?: string // Optional display title for the sub-block
  type: SubBlockType // The UI type for rendering the sub-block
  layout?: SubBlockLayout // Layout configuration (full or half width)
  options?: string[] | { label: string; id: string }[] // Options available for selection controls (e.g., dropdowns)
  min?: number // Minimum value allowed (for numeric inputs)
  max?: number // Maximum value allowed (for numeric inputs)
  columns?: string[] // For table layouts: names of the columns
  placeholder?: string // Placeholder text shown in the input area
  password?: boolean // If true, the input is masked (useful for passwords or API keys)
  sensitive?: boolean // Flag indicating this field contains sensitive data to be redacted
  connectionDroppable?: boolean // Whether this sub-block can accept connections from other blocks
  hidden?: boolean // If true, the sub-block is hidden from the UI
  value?: (params: Record<string, any>) => string // Function to calculate a default value based on other parameters
  condition?: {
    // Condition that governs when this sub-block should be active or visible
    field: string // The field to evaluate for the condition
    value: string | number | boolean // The value that triggers the condition
    and?: {
      // Optional secondary condition for more complex logic
      field: string // Second field to examine
      value: string | number | boolean // Value that the second field must have to trigger the condition
    }
  }
}

// Main block configuration defining the complete structure and properties of a block
export interface BlockConfig<T extends ToolResponse = ToolResponse> {
  type: string // Unique string identifying the block type
  name: string // Human-readable name for the block
  description: string // Short description explaining the block's purpose
  category: BlockCategory // Classification: either a generic block or a tool block
  longDescription?: string // Detailed description of the block if needed
  bgColor: string // Background color used in the block's UI representation
  icon: BlockIcon // Icon component for visual representation of the block
  subBlocks: SubBlockConfig[] // Array of sub-blocks (individual inputs/controls) within the block
  tools: {
    // Configuration for any associated external tools
    access: string[] // List of access scopes or identifiers for the tool(s)
    config?: {
      // Optional configuration function to determine the tool dynamically
      tool: (params: Record<string, any>) => string // Function that returns a tool id based on the provided parameters
    }
  }
  inputs: Record<string, ParamConfig> // Mapping of input parameters for the block
  outputs: {
    // Configuration for the block's outputs
    response: {
      type: ToolOutputToValueType<ExtractToolOutput<T>> // Defines the type of output based on the tool response
      dependsOn?: {
        // Optional dependency: output type may depend on a specific sub-block's state
        subBlockId: string // Identifier of the dependent sub-block
        condition: {
          // Conditions that determine the output type
          whenEmpty: ToolOutputToValueType<ExtractToolOutput<T>> // Output type if the sub-block is empty
          whenFilled: 'json' // Output type if the sub-block contains a value (assumed to be json)
        }
      }
    }
  }
}

// Configuration for handling output rules based on sub-block conditions
export interface OutputConfig {
  type: BlockOutput // Expected output type of the block
  dependsOn?: {
    // Optional mapping of sub-block dependency that dictates the output type
    subBlockId: string // Sub-block identifier that the output depends on
    condition: {
      // Conditions to determine the type of output based on sub-block value
      whenEmpty: BlockOutput // Output type if the sub-block's value is empty
      whenFilled: BlockOutput // Output type if the sub-block's value is present
    }
  }
}
