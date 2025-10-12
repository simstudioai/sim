import type { ToolConfig } from '@/tools/types'

export interface GuardrailsValidateInput {
  input: string
  validationType: 'json' | 'regex' | 'hallucination' | 'pii'
  regex?: string
  knowledgeBaseId?: string
  threshold?: string
  topK?: string
  model?: string
  apiKey?: string
  piiEntityTypes?: string[]
  piiMode?: string
  piiLanguage?: string
  _context?: {
    workflowId?: string
    workspaceId?: string
  }
}

export interface GuardrailsValidateOutput {
  success: boolean
  output: {
    passed: boolean
    validationType: string
    content: string
    error?: string
    score?: number
    reasoning?: string
    detectedEntities?: any[]
    maskedText?: string
  }
  error?: string
}

export const guardrailsValidateTool: ToolConfig<GuardrailsValidateInput, GuardrailsValidateOutput> =
  {
    id: 'guardrails_validate',
    name: 'Guardrails Validate',
    description:
      'Validate content using guardrails (JSON, regex, hallucination check, or PII detection)',
    version: '1.0.0',

    params: {
      input: {
        type: 'string',
        required: true,
        description: 'Content to validate (from wired block)',
      },
      validationType: {
        type: 'string',
        required: true,
        description: 'Type of validation: json, regex, hallucination, or pii',
      },
      regex: {
        type: 'string',
        required: false,
        description: 'Regex pattern (required for regex validation)',
      },
      knowledgeBaseId: {
        type: 'string',
        required: false,
        description: 'Knowledge base ID (required for hallucination check)',
      },
      threshold: {
        type: 'string',
        required: false,
        description: 'Confidence threshold (0-10 scale, default: 3, scores below fail)',
      },
      topK: {
        type: 'string',
        required: false,
        description: 'Number of chunks to retrieve from knowledge base (default: 10)',
      },
      model: {
        type: 'string',
        required: false,
        description: 'LLM model for confidence scoring (default: gpt-4o-mini)',
      },
      apiKey: {
        type: 'string',
        required: false,
        description: 'API key for LLM provider (optional if using hosted)',
      },
      piiEntityTypes: {
        type: 'array',
        required: false,
        description: 'PII entity types to detect (empty = detect all)',
      },
      piiMode: {
        type: 'string',
        required: false,
        description: 'PII action mode: block or mask (default: block)',
      },
      piiLanguage: {
        type: 'string',
        required: false,
        description: 'Language for PII detection (default: en)',
      },
    },

    outputs: {
      passed: {
        type: 'boolean',
        description: 'Whether validation passed',
      },
      validationType: {
        type: 'string',
        description: 'Type of validation performed',
      },
      input: {
        type: 'string',
        description: 'Original input',
      },
      error: {
        type: 'string',
        description: 'Error message if validation failed',
        optional: true,
      },
      score: {
        type: 'number',
        description:
          'Confidence score (0-10, 0=hallucination, 10=grounded, only for hallucination check)',
        optional: true,
      },
      reasoning: {
        type: 'string',
        description: 'Reasoning for confidence score (only for hallucination check)',
        optional: true,
      },
      detectedEntities: {
        type: 'array',
        description: 'Detected PII entities (only for PII detection)',
        optional: true,
      },
      maskedText: {
        type: 'string',
        description: 'Text with PII masked (only for PII detection in mask mode)',
        optional: true,
      },
    },

    request: {
      url: '/api/guardrails/validate',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params: GuardrailsValidateInput) => ({
        input: params.input,
        validationType: params.validationType,
        regex: params.regex,
        knowledgeBaseId: params.knowledgeBaseId,
        threshold: params.threshold,
        topK: params.topK,
        model: params.model,
        apiKey: params.apiKey,
        piiEntityTypes: params.piiEntityTypes,
        piiMode: params.piiMode,
        piiLanguage: params.piiLanguage,
        workflowId: params._context?.workflowId,
        workspaceId: params._context?.workspaceId,
      }),
    },

    transformResponse: async (response: Response): Promise<GuardrailsValidateOutput> => {
      const result = await response.json()

      if (!response.ok && !result.output) {
        return {
          success: true,
          output: {
            passed: false,
            validationType: 'unknown',
            content: '',
            error: result.error || `Validation failed with status ${response.status}`,
          },
        }
      }

      return result
    },
  }
