import { z } from 'zod'
import type { ToolResponse } from '../types'

export interface StagehandExtractParams {
  instruction: string
  schema: Record<string, any>
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
  apiKey: string
  options?: {
    useTextExtract?: boolean
    selector?: string
  }
}

export interface StagehandAgentAction {
  type: string
  params: Record<string, any>
  result: Record<string, any>
}

export interface StagehandAgentResult {
  success: boolean
  completed: boolean
  message: string
  actions: StagehandAgentAction[]
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
