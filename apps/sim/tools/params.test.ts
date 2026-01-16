import { describe, expect, it, vi } from 'vitest'
import {
  createExecutionToolSchema,
  createLLMToolSchema,
  createUserToolSchema,
  filterSchemaForLLM,
  formatParameterLabel,
  getToolParametersConfig,
  isPasswordParameter,
  mergeToolParameters,
  type ToolParameterConfig,
  type ToolSchema,
  type ValidationResult,
  validateToolParameters,
} from '@/tools/params'
import type { HttpMethod, ParameterVisibility } from '@/tools/types'

const mockToolConfig = {
  id: 'test_tool',
  name: 'Test Tool',
  description: 'A test tool for parameter handling',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only' as ParameterVisibility,
      description: 'API key for authentication',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm' as ParameterVisibility,
      description: 'Message to send',
    },
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-only' as ParameterVisibility,
      description: 'Channel to send message to',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only' as ParameterVisibility,
      default: 5000,
      description: 'Request timeout in milliseconds',
    },
  },
  request: {
    url: 'https://api.example.com/test',
    method: 'POST' as HttpMethod,
    headers: () => ({}),
  },
}

vi.mock('@/tools/utils', () => ({
  getTool: vi.fn((toolId: string) => {
    if (toolId === 'test_tool') {
      return mockToolConfig
    }
    return null
  }),
}))

describe('Tool Parameters Utils', () => {
  describe('getToolParametersConfig', () => {
    it.concurrent('should return tool parameters configuration', () => {
      const result = getToolParametersConfig('test_tool')

      expect(result).toBeDefined()
      expect(result?.toolConfig).toEqual(mockToolConfig)
      expect(result?.allParameters).toHaveLength(4)
      expect(result?.userInputParameters).toHaveLength(4) // apiKey, message, channel, timeout (all have visibility)
      expect(result?.requiredParameters).toHaveLength(2) // apiKey, message (both required: true)
      expect(result?.optionalParameters).toHaveLength(2) // channel, timeout (both user-only + required: false)
    })

    it.concurrent('should return null for non-existent tool', () => {
      const result = getToolParametersConfig('non_existent_tool')
      expect(result).toBeNull()
    })
  })

  describe('createLLMToolSchema', () => {
    it.concurrent('should create schema excluding user-provided parameters', async () => {
      const userProvidedParams = {
        apiKey: 'user-provided-key',
        channel: '#general',
      }

      const schema = await createLLMToolSchema(mockToolConfig, userProvidedParams)

      expect(schema.properties).not.toHaveProperty('apiKey') // user-only, excluded
      expect(schema.properties).not.toHaveProperty('channel') // user-provided, excluded
      expect(schema.properties).toHaveProperty('message') // user-or-llm, included
      expect(schema.properties).not.toHaveProperty('timeout') // user-only, excluded
      expect(schema.required).toContain('message') // user-or-llm + required: true
      expect(schema.required).not.toContain('apiKey') // user-only, never required for LLM
    })

    it.concurrent('should include all parameters when none are user-provided', async () => {
      const schema = await createLLMToolSchema(mockToolConfig, {})

      expect(schema.properties).not.toHaveProperty('apiKey') // user-only, never shown to LLM
      expect(schema.properties).toHaveProperty('message') // user-or-llm, shown to LLM
      expect(schema.properties).not.toHaveProperty('channel') // user-only, never shown to LLM
      expect(schema.properties).not.toHaveProperty('timeout') // user-only, never shown to LLM
      expect(schema.required).not.toContain('apiKey') // user-only, never required for LLM
      expect(schema.required).toContain('message') // user-or-llm + required: true
    })
  })

  describe('createUserToolSchema', () => {
    it.concurrent('should include user-only parameters and omit hidden ones', () => {
      const toolWithHiddenParam = {
        ...mockToolConfig,
        id: 'user_schema_tool',
        params: {
          ...mockToolConfig.params,
          spreadsheetId: {
            type: 'string',
            required: true,
            visibility: 'user-only' as ParameterVisibility,
            description: 'Spreadsheet ID to operate on',
          },
          accessToken: {
            type: 'string',
            required: true,
            visibility: 'hidden' as ParameterVisibility,
            description: 'OAuth access token',
          },
        },
      }

      const schema = createUserToolSchema(toolWithHiddenParam)

      expect(schema.properties).toHaveProperty('spreadsheetId')
      expect(schema.required).toContain('spreadsheetId')
      expect(schema.properties).not.toHaveProperty('accessToken')
      expect(schema.required).not.toContain('accessToken')
      expect(schema.properties).toHaveProperty('message')
    })
  })

  describe('createExecutionToolSchema', () => {
    it.concurrent('should create complete schema with all parameters', () => {
      const schema = createExecutionToolSchema(mockToolConfig)

      expect(schema.properties).toHaveProperty('apiKey')
      expect(schema.properties).toHaveProperty('message')
      expect(schema.properties).toHaveProperty('channel')
      expect(schema.properties).toHaveProperty('timeout')
      expect(schema.required).toContain('apiKey')
      expect(schema.required).toContain('message')
      expect(schema.required).not.toContain('channel')
      expect(schema.required).not.toContain('timeout')
    })
  })

  describe('mergeToolParameters', () => {
    it.concurrent('should merge parameters with user-provided taking precedence', () => {
      const userProvided = {
        apiKey: 'user-key',
        channel: '#general',
      }
      const llmGenerated = {
        message: 'Hello world',
        channel: '#random',
        timeout: 10000,
      }

      const merged = mergeToolParameters(userProvided, llmGenerated)

      expect(merged.apiKey).toBe('user-key')
      expect(merged.channel).toBe('#general')
      expect(merged.message).toBe('Hello world')
      expect(merged.timeout).toBe(10000)
    })

    it.concurrent('should skip empty strings so LLM values are used', () => {
      const userProvided = {
        apiKey: 'user-key',
        channel: '', // User cleared this field
        message: '', // User cleared this field too
      }
      const llmGenerated = {
        message: 'Hello world',
        channel: '#random',
        timeout: 10000,
      }

      const merged = mergeToolParameters(userProvided, llmGenerated)

      expect(merged.apiKey).toBe('user-key') // Non-empty user value preserved
      expect(merged.channel).toBe('#random') // LLM value used because user value was empty
      expect(merged.message).toBe('Hello world') // LLM value used because user value was empty
      expect(merged.timeout).toBe(10000)
    })

    it.concurrent('should skip null and undefined values', () => {
      const userProvided = {
        apiKey: 'user-key',
        channel: null,
        message: undefined,
      }
      const llmGenerated = {
        message: 'Hello world',
        channel: '#random',
      }

      const merged = mergeToolParameters(userProvided, llmGenerated)

      expect(merged.apiKey).toBe('user-key')
      expect(merged.channel).toBe('#random') // LLM value used
      expect(merged.message).toBe('Hello world') // LLM value used
    })
  })

  describe('validateToolParameters', () => {
    it.concurrent('should validate successfully with all required parameters', () => {
      const finalParams = {
        apiKey: 'test-key',
        message: 'Hello world',
        channel: '#general',
      }

      const result = validateToolParameters(mockToolConfig, finalParams)

      expect(result.valid).toBe(true)
      expect(result.missingParams).toHaveLength(0)
    })

    it.concurrent('should fail validation with missing required parameters', () => {
      const finalParams = {
        channel: '#general',
      }

      const result = validateToolParameters(mockToolConfig, finalParams)

      expect(result.valid).toBe(false)
      expect(result.missingParams).toContain('apiKey')
      expect(result.missingParams).toContain('message')
    })
  })

  describe('filterSchemaForLLM', () => {
    it.concurrent('should filter out user-provided parameters from schema', () => {
      const originalSchema: ToolSchema = {
        type: 'object' as const,
        properties: {
          apiKey: { type: 'string', description: 'API key' },
          message: { type: 'string', description: 'Message' },
          channel: { type: 'string', description: 'Channel' },
        },
        required: ['apiKey', 'message'],
      }

      const userProvidedParams = {
        apiKey: 'user-key',
        channel: '#general',
      }

      const filtered = filterSchemaForLLM(originalSchema, userProvidedParams)

      expect(filtered.properties).not.toHaveProperty('apiKey')
      expect(filtered.properties).not.toHaveProperty('channel')
      expect(filtered.properties).toHaveProperty('message')
      expect(filtered.required).not.toContain('apiKey')
      expect(filtered.required).toContain('message')
    })
  })

  describe('formatParameterLabel', () => {
    it.concurrent('should format parameter labels correctly', () => {
      expect(formatParameterLabel('apiKey')).toBe('API Key')
      expect(formatParameterLabel('apiVersion')).toBe('API Version')
      expect(formatParameterLabel('userName')).toBe('User Name')
      expect(formatParameterLabel('user_name')).toBe('User Name')
      expect(formatParameterLabel('user-name')).toBe('User Name')
      expect(formatParameterLabel('message')).toBe('Message')
      expect(formatParameterLabel('a')).toBe('A')
    })
  })

  describe('isPasswordParameter', () => {
    it.concurrent('should identify password parameters correctly', () => {
      expect(isPasswordParameter('password')).toBe(true)
      expect(isPasswordParameter('apiKey')).toBe(true)
      expect(isPasswordParameter('token')).toBe(true)
      expect(isPasswordParameter('secret')).toBe(true)
      expect(isPasswordParameter('accessToken')).toBe(true)
      expect(isPasswordParameter('message')).toBe(false)
      expect(isPasswordParameter('channel')).toBe(false)
      expect(isPasswordParameter('timeout')).toBe(false)
    })
  })

  describe('workflow_executor inputMapping handling', () => {
    const mockWorkflowExecutorConfig = {
      id: 'workflow_executor',
      name: 'Workflow Executor',
      description: 'Execute another workflow',
      version: '1.0.0',
      params: {
        workflowId: {
          type: 'string',
          required: true,
          visibility: 'user-or-llm' as ParameterVisibility,
          description: 'The ID of the workflow to execute',
        },
        inputMapping: {
          type: 'object',
          required: false,
          visibility: 'user-or-llm' as ParameterVisibility,
          description: 'Map inputs to the selected workflow',
        },
      },
      request: {
        url: 'https://api.example.com/workflows',
        method: 'POST' as HttpMethod,
        headers: () => ({}),
      },
    }

    describe('createLLMToolSchema - inputMapping always included', () => {
      it.concurrent(
        'should include inputMapping in schema even when user provides empty object',
        async () => {
          const userProvidedParams = {
            workflowId: 'workflow-123',
            inputMapping: '{}',
          }

          const schema = await createLLMToolSchema(mockWorkflowExecutorConfig, userProvidedParams)

          expect(schema.properties).toHaveProperty('inputMapping')
          expect(schema.properties.inputMapping.type).toBe('object')
        }
      )

      it.concurrent(
        'should include inputMapping in schema even when user provides object with empty values',
        async () => {
          const userProvidedParams = {
            workflowId: 'workflow-123',
            inputMapping: '{"query": "", "limit": ""}',
          }

          const schema = await createLLMToolSchema(mockWorkflowExecutorConfig, userProvidedParams)

          expect(schema.properties).toHaveProperty('inputMapping')
        }
      )

      it.concurrent(
        'should include inputMapping when user has not provided it at all',
        async () => {
          const userProvidedParams = {
            workflowId: 'workflow-123',
          }

          const schema = await createLLMToolSchema(mockWorkflowExecutorConfig, userProvidedParams)

          expect(schema.properties).toHaveProperty('inputMapping')
        }
      )

      it.concurrent('should exclude workflowId from schema when user provides it', async () => {
        const userProvidedParams = {
          workflowId: 'workflow-123',
        }

        const schema = await createLLMToolSchema(mockWorkflowExecutorConfig, userProvidedParams)

        expect(schema.properties).not.toHaveProperty('workflowId')
        expect(schema.properties).toHaveProperty('inputMapping')
      })
    })

    describe('mergeToolParameters - inputMapping deep merge', () => {
      it.concurrent('should deep merge inputMapping when user provides empty object', () => {
        const userProvided = {
          workflowId: 'workflow-123',
          inputMapping: '{}',
        }
        const llmGenerated = {
          inputMapping: { query: 'search term', limit: 10 },
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.inputMapping).toEqual({ query: 'search term', limit: 10 })
        expect(merged.workflowId).toBe('workflow-123')
      })

      it.concurrent('should deep merge inputMapping when user provides partial values', () => {
        const userProvided = {
          workflowId: 'workflow-123',
          inputMapping: '{"query": "", "customField": "user-value"}',
        }
        const llmGenerated = {
          inputMapping: { query: 'llm-search', limit: 10 },
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.inputMapping).toEqual({
          query: 'llm-search',
          limit: 10,
          customField: 'user-value',
        })
      })

      it.concurrent('should preserve user inputMapping values when they are non-empty', () => {
        const userProvided = {
          workflowId: 'workflow-123',
          inputMapping: '{"query": "user-search", "limit": 5}',
        }
        const llmGenerated = {
          inputMapping: { query: 'llm-search', limit: 10, extra: 'field' },
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.inputMapping).toEqual({
          query: 'user-search',
          limit: 5,
          extra: 'field',
        })
      })

      it.concurrent('should handle inputMapping as object (not JSON string)', () => {
        const userProvided = {
          workflowId: 'workflow-123',
          inputMapping: { query: '', customField: 'user-value' },
        }
        const llmGenerated = {
          inputMapping: { query: 'llm-search', limit: 10 },
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.inputMapping).toEqual({
          query: 'llm-search',
          limit: 10,
          customField: 'user-value',
        })
      })

      it.concurrent('should use LLM inputMapping when user does not provide it', () => {
        const userProvided = {
          workflowId: 'workflow-123',
        }
        const llmGenerated = {
          inputMapping: { query: 'llm-search', limit: 10 },
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.inputMapping).toEqual({ query: 'llm-search', limit: 10 })
      })

      it.concurrent('should use user inputMapping when LLM does not provide it', () => {
        const userProvided = {
          workflowId: 'workflow-123',
          inputMapping: '{"query": "user-search"}',
        }
        const llmGenerated = {}

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.inputMapping).toEqual({ query: 'user-search' })
      })

      it.concurrent('should handle invalid JSON in user inputMapping gracefully', () => {
        const userProvided = {
          workflowId: 'workflow-123',
          inputMapping: 'not valid json {',
        }
        const llmGenerated = {
          inputMapping: { query: 'llm-search' },
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.inputMapping).toEqual({ query: 'llm-search' })
      })

      it.concurrent(
        'should fill field when user typed something then removed it (field becomes empty string)',
        () => {
          const userProvided = {
            workflowId: 'workflow-123',
            inputMapping: '{"query": ""}',
          }
          const llmGenerated = {
            inputMapping: { query: 'llm-generated-search' },
          }

          const merged = mergeToolParameters(userProvided, llmGenerated)

          expect(merged.inputMapping).toEqual({ query: 'llm-generated-search' })
        }
      )

      it.concurrent('should not affect other parameters - normal override behavior', () => {
        const userProvided = {
          apiKey: 'user-key',
          channel: '#general',
        }
        const llmGenerated = {
          message: 'Hello world',
          channel: '#random',
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        expect(merged.apiKey).toBe('user-key')
        expect(merged.channel).toBe('#general')
        expect(merged.message).toBe('Hello world')
      })

      it.concurrent('should preserve 0 and false as valid user values in inputMapping', () => {
        const userProvided = {
          workflowId: 'workflow-123',
          inputMapping: '{"limit": 0, "enabled": false, "query": ""}',
        }
        const llmGenerated = {
          inputMapping: { limit: 10, enabled: true, query: 'llm-search' },
        }

        const merged = mergeToolParameters(userProvided, llmGenerated)

        // 0 and false should be preserved (they're valid values)
        // empty string should be filled by LLM
        expect(merged.inputMapping).toEqual({
          limit: 0,
          enabled: false,
          query: 'llm-search',
        })
      })
    })
  })

  describe('Type Interface Validation', () => {
    it.concurrent('should have properly typed ToolSchema', async () => {
      const schema: ToolSchema = await createLLMToolSchema(mockToolConfig, {})

      expect(schema.type).toBe('object')
      expect(typeof schema.properties).toBe('object')
      expect(Array.isArray(schema.required)).toBe(true)

      Object.values(schema.properties).forEach((prop) => {
        expect(prop).toHaveProperty('type')
        expect(prop).toHaveProperty('description')
        expect(typeof prop.type).toBe('string')
        expect(typeof prop.description).toBe('string')
      })
    })

    it.concurrent('should have properly typed ValidationResult', () => {
      const result: ValidationResult = validateToolParameters(mockToolConfig, {})

      expect(typeof result.valid).toBe('boolean')
      expect(Array.isArray(result.missingParams)).toBe(true)
      expect(result.missingParams.every((param) => typeof param === 'string')).toBe(true)
    })

    it.concurrent('should have properly typed ToolParameterConfig', () => {
      const config = getToolParametersConfig('test_tool')
      expect(config).toBeDefined()

      if (config) {
        config.allParameters.forEach((param: ToolParameterConfig) => {
          expect(typeof param.id).toBe('string')
          expect(typeof param.type).toBe('string')
          expect(typeof param.required).toBe('boolean')
          expect(
            ['user-or-llm', 'user-only', 'llm-only', 'hidden'].includes(param.visibility!)
          ).toBe(true)
          if (param.description) expect(typeof param.description).toBe('string')
          if (param.uiComponent) {
            expect(typeof param.uiComponent.type).toBe('string')
          }
        })
      }
    })
  })
})
