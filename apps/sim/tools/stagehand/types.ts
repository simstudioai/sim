import { z } from 'zod'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Stagehand API responses.
 * Based on Stagehand documentation:
 * - https://docs.stagehand.dev/v3/references/agent
 * - https://docs.stagehand.dev/v3/references/extract
 * - https://github.com/browserbase/stagehand
 */

/**
 * Output definition for usage statistics from agent execution
 * Based on Stagehand AgentResult.usage structure
 */
export const STAGEHAND_USAGE_OUTPUT_PROPERTIES = {
  input_tokens: { type: 'number', description: 'Number of input tokens consumed' },
  output_tokens: { type: 'number', description: 'Number of output tokens generated' },
  reasoning_tokens: {
    type: 'number',
    description: 'Number of tokens used for reasoning',
    optional: true,
  },
  cached_input_tokens: {
    type: 'number',
    description: 'Number of cached input tokens used',
    optional: true,
  },
  inference_time_ms: { type: 'number', description: 'Total inference time in milliseconds' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete usage statistics output definition
 */
export const STAGEHAND_USAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Token usage and timing statistics from agent execution',
  optional: true,
  properties: STAGEHAND_USAGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for agent action objects
 * Based on Stagehand AgentAction interface
 */
export const STAGEHAND_ACTION_OUTPUT_PROPERTIES = {
  type: {
    type: 'string',
    description:
      'Type of action performed (e.g., "act", "observe", "ariaTree", "close", "wait", "navigate")',
  },
  reasoning: {
    type: 'string',
    description: 'AI reasoning for why this action was taken',
    optional: true,
  },
  taskCompleted: {
    type: 'boolean',
    description: 'Whether the task was completed after this action',
    optional: true,
  },
  action: {
    type: 'string',
    description: 'Description of the action taken (e.g., "click the submit button")',
    optional: true,
  },
  instruction: {
    type: 'string',
    description: 'Instruction that triggered this action',
    optional: true,
  },
  pageUrl: {
    type: 'string',
    description: 'URL of the page when this action was performed',
    optional: true,
  },
  pageText: {
    type: 'string',
    description: 'Page text content (for ariaTree actions)',
    optional: true,
  },
  timestamp: {
    type: 'number',
    description: 'Unix timestamp when the action was performed',
    optional: true,
  },
  timeMs: {
    type: 'number',
    description: 'Time in milliseconds (for wait actions)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete agent action output definition
 */
export const STAGEHAND_ACTION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Record of an action performed by the agent',
  properties: STAGEHAND_ACTION_OUTPUT_PROPERTIES,
}

/**
 * Actions array output definition
 */
export const STAGEHAND_ACTIONS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of all actions performed by the agent during task execution',
  items: {
    type: 'object',
    properties: STAGEHAND_ACTION_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for agent result objects
 * Based on Stagehand AgentResult interface
 */
export const STAGEHAND_AGENT_RESULT_OUTPUT_PROPERTIES = {
  success: {
    type: 'boolean',
    description: 'Whether the agent task completed successfully without errors',
  },
  completed: {
    type: 'boolean',
    description: 'Whether the agent finished executing (may be false if max steps reached)',
  },
  message: {
    type: 'string',
    description: 'Final status message or result summary from the agent',
  },
  actions: STAGEHAND_ACTIONS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete agent result output definition
 */
export const STAGEHAND_AGENT_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Complete result from the Stagehand agent execution',
  properties: STAGEHAND_AGENT_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for act() method results
 * Based on Stagehand ActResult interface
 */
export const STAGEHAND_ACT_ACTION_OUTPUT_PROPERTIES = {
  selector: {
    type: 'string',
    description: 'XPath or CSS selector of the element acted upon',
  },
  description: {
    type: 'string',
    description: 'Description of the element or action',
  },
  method: {
    type: 'string',
    description: 'Method used (e.g., "click", "type", "scroll")',
  },
  arguments: {
    type: 'array',
    description: 'Arguments passed to the method',
    items: {
      type: 'string',
      description: 'Method argument value',
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for act() result
 */
export const STAGEHAND_ACT_RESULT_OUTPUT_PROPERTIES = {
  success: {
    type: 'boolean',
    description: 'Whether the act operation completed successfully',
  },
  message: {
    type: 'string',
    description: 'Detailed message about the actions performed',
  },
  actionDescription: {
    type: 'string',
    description: 'High-level description of what was done',
    optional: true,
  },
  actions: {
    type: 'array',
    description: 'List of individual actions performed',
    items: {
      type: 'object',
      properties: STAGEHAND_ACT_ACTION_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for extract() method when called without schema
 * Returns pageText or extraction string
 */
export const STAGEHAND_SIMPLE_EXTRACT_OUTPUT_PROPERTIES = {
  pageText: {
    type: 'string',
    description: 'Raw text content of the page (when no instruction provided)',
    optional: true,
  },
  extraction: {
    type: 'string',
    description: 'Extracted content based on instruction (when no schema provided)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for extract() method result with schema
 * The actual structure depends on the user-provided schema
 */
export const STAGEHAND_EXTRACT_OUTPUT_PROPERTIES = {
  data: {
    type: 'object',
    description: 'Extracted structured data matching the provided schema',
  },
  schema: {
    type: 'object',
    description: 'The schema that was used for extraction',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface StagehandExtractParams {
  instruction: string
  schema: Record<string, any>
  provider?: 'openai' | 'anthropic'
  apiKey: string
  url: string
}

export interface StagehandExtractResponse extends ToolResponse {
  output: Record<string, any>
}

export interface StagehandAgentParams {
  task: string
  startUrl: string
  outputSchema?: Record<string, any>
  variables?: Record<string, string>
  provider?: 'openai' | 'anthropic'
  apiKey: string
  options?: {
    useTextExtract?: boolean
    selector?: string
  }
}

export interface StagehandAgentAction {
  type: string
  reasoning?: string
  taskCompleted?: boolean
  action?: string
  instruction?: string
  pageUrl?: string
  pageText?: string
  timestamp?: number
  timeMs?: number
  [key: string]: unknown
}

export interface StagehandAgentUsage {
  input_tokens: number
  output_tokens: number
  reasoning_tokens?: number
  cached_input_tokens?: number
  inference_time_ms: number
}

export interface StagehandAgentResult {
  success: boolean
  completed: boolean
  message: string
  actions: StagehandAgentAction[]
  usage?: StagehandAgentUsage
}

export interface StagehandAgentResponse extends ToolResponse {
  output: {
    agentResult: StagehandAgentResult
    structuredOutput?: Record<string, any>
  }
}

export function jsonSchemaToZod(jsonSchema: Record<string, any>): z.ZodTypeAny {
  if (!jsonSchema) {
    throw new Error('Invalid schema: Schema is required')
  }

  // Handle different schema types
  switch (jsonSchema.type) {
    case 'object': {
      if (!jsonSchema.properties) {
        return z.object({})
      }

      const shape: Record<string, z.ZodTypeAny> = {}
      const requiredFields = new Set(jsonSchema.required || [])

      for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
        // Create the base schema for this property
        let fieldSchema = jsonSchemaToZod(propSchema as Record<string, any>)

        // Make it optional if not in required fields
        if (!requiredFields.has(key)) {
          fieldSchema = fieldSchema.optional()
        }

        // Add description if available
        if ((propSchema as Record<string, any>).description) {
          fieldSchema = fieldSchema.describe((propSchema as Record<string, any>).description)
        }

        shape[key] = fieldSchema
      }

      return z.object(shape)
    }

    case 'array':
      if (!jsonSchema.items) {
        return z.array(z.any())
      }
      return z.array(jsonSchemaToZod(jsonSchema.items as Record<string, any>))

    case 'string':
      return z.string()

    case 'number':
      return z.number()

    case 'boolean':
      return z.boolean()

    case 'null':
      return z.null()

    default:
      return z.any()
  }
}
