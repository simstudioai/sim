import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { InputResolver } from './resolver'

// Mock logger
vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('InputResolver', () => {
  let sampleWorkflow: SerializedWorkflow
  let mockContext: any
  let mockEnvironmentVars: Record<string, string>
  let mockWorkflowVars: Record<string, any>
  let resolver: InputResolver

  beforeEach(() => {
    // Set up a sample workflow with different types of blocks
    sampleWorkflow = {
      version: '1.0',
      blocks: [
        {
          id: 'starter-block',
          metadata: { id: 'starter', name: 'Start' },
          position: { x: 100, y: 100 },
          config: { tool: 'starter', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-block',
          metadata: { id: 'function', name: 'Function' },
          position: { x: 300, y: 100 },
          config: { tool: 'function', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'condition-block',
          metadata: { id: 'condition', name: 'Condition' },
          position: { x: 500, y: 100 },
          config: { tool: 'condition', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'api-block',
          metadata: { id: 'api', name: 'API' },
          position: { x: 700, y: 100 },
          config: { tool: 'api', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'disabled-block',
          metadata: { id: 'generic', name: 'Disabled Block' },
          position: { x: 900, y: 100 },
          config: { tool: 'generic', params: {} },
          inputs: {},
          outputs: {},
          enabled: false,
        },
      ],
      connections: [], // Using connections instead of edges to match SerializedWorkflow type
      loops: {},
    }

    // Mock execution context
    mockContext = {
      workflowId: 'test-workflow',
      blockStates: new Map([
        ['starter-block', { output: { response: { input: 'Hello World', type: 'text' } } }],
        ['function-block', { output: { response: { result: '42' } } }], // String value as it would be in real app
      ]),
      activeExecutionPath: new Set(['starter-block', 'function-block']),
      loopIterations: new Map(),
    }

    // Mock environment variables
    mockEnvironmentVars = {
      API_KEY: 'test-api-key',
      BASE_URL: 'https://api.example.com',
    }

    // Mock workflow variables
    mockWorkflowVars = {
      stringVar: {
        id: 'var1',
        workflowId: 'test-workflow',
        name: 'stringVar',
        type: 'string',
        value: 'Hello',
      },
      numberVar: {
        id: 'var2',
        workflowId: 'test-workflow',
        name: 'numberVar',
        type: 'number',
        value: '42', // Stored as string but should be converted to number
      },
      boolVar: {
        id: 'var3',
        workflowId: 'test-workflow',
        name: 'boolVar',
        type: 'boolean',
        value: 'true', // Stored as string but should be converted to boolean
      },
      objectVar: {
        id: 'var4',
        workflowId: 'test-workflow',
        name: 'objectVar',
        type: 'object',
        value: '{"name":"John","age":30}', // Stored as string but should be parsed to object
      },
      arrayVar: {
        id: 'var5',
        workflowId: 'test-workflow',
        name: 'arrayVar',
        type: 'array',
        value: '[1,2,3]', // Stored as string but should be parsed to array
      },
      plainVar: {
        id: 'var6',
        workflowId: 'test-workflow',
        name: 'plainVar',
        type: 'plain',
        value: 'Raw text without quotes',
      },
    }

    // Create resolver
    resolver = new InputResolver(sampleWorkflow, mockEnvironmentVars, mockWorkflowVars)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Variable Value Resolution', () => {
    it('should resolve string variables correctly', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            directRef: '<variable.stringVar>',
            interpolated: 'Hello <variable.stringVar>!',
          },
        },
        inputs: {
          directRef: 'string',
          interpolated: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.directRef).toBe('Hello')
      expect(result.interpolated).toBe('Hello Hello!')
    })

    it('should resolve number variables correctly', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            directRef: '<variable.numberVar>',
            interpolated: 'The number is <variable.numberVar>',
          },
        },
        inputs: {
          directRef: 'number',
          interpolated: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.directRef).toBe(42) // Should be converted to actual number
      expect(result.interpolated).toBe('The number is 42')
    })

    it('should resolve boolean variables correctly', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            directRef: '<variable.boolVar>',
            interpolated: 'Is it true? <variable.boolVar>',
          },
        },
        inputs: {
          directRef: 'boolean',
          interpolated: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.directRef).toBe(true) // Should be converted to boolean
      expect(result.interpolated).toBe('Is it true? true')
    })

    it('should resolve object variables correctly', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            directRef: '<variable.objectVar>',
          },
        },
        inputs: {
          directRef: 'json',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.directRef).toEqual({ name: 'John', age: 30 }) // Should be parsed to object
    })

    it('should resolve plain text variables without quoting', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            directRef: '<variable.plainVar>',
            interpolated: 'Content: <variable.plainVar>',
          },
        },
        inputs: {
          directRef: 'string',
          interpolated: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.directRef).toBe('Raw text without quotes')
      expect(result.interpolated).toBe('Content: Raw text without quotes')
    })
  })

  describe('Block Reference Resolution', () => {
    it('should resolve references to other blocks', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            starterRef: '<starter-block.response.input>',
            functionRef: '<function-block.response.result>',
            nameRef: '<Start.response.input>', // Reference by name
          },
        },
        inputs: {
          starterRef: 'string',
          functionRef: 'string',
          nameRef: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.starterRef).toBe('Hello World')
      expect(result.functionRef).toBe('42') // String representation
      expect(result.nameRef).toBe('Hello World') // Should resolve using block name
    })

    it('should handle the special "start" alias for starter block', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            startRef: '<start.response.input>',
            startType: '<start.response.type>',
          },
        },
        inputs: {
          startRef: 'string',
          startType: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.startRef).toBe('Hello World')
      expect(result.startType).toBe('text')
    })

    it('should throw an error for references to inactive blocks', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            inactiveRef: '<condition-block.response.result>', // Not in activeExecutionPath
          },
        },
        inputs: {
          inactiveRef: 'string',
        },
        outputs: {},
        enabled: true,
      }

      // Since the condition-block is not in the active execution path,
      // we expect it to be treated as inactive and return an empty string
      const result = resolver.resolveInputs(block, mockContext)
      expect(result.inactiveRef).toBe('')
    })

    it('should throw an error for references to disabled blocks', () => {
      // Enable the disabled block but keep it out of execution path
      const disabledBlock = sampleWorkflow.blocks.find((b) => b.id === 'disabled-block')!
      disabledBlock.enabled = false

      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            disabledRef: '<disabled-block.response.result>',
          },
        },
        inputs: {
          disabledRef: 'string',
        },
        outputs: {},
        enabled: true,
      }

      expect(() => resolver.resolveInputs(block, mockContext)).toThrow(/Block ".+" is disabled/)
    })
  })

  describe('Environment Variable Resolution', () => {
    it('should resolve environment variables in API key contexts', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'api', name: 'Test API Block' }, // API block type
        position: { x: 0, y: 0 },
        config: {
          tool: 'api',
          params: {
            apiKey: '{{API_KEY}}',
            url: 'https://example.com?key={{API_KEY}}',
            regularParam: 'Base URL is: {{BASE_URL}}', // Should not be resolved in regular params
          },
        },
        inputs: {
          apiKey: 'string',
          url: 'string',
          regularParam: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.apiKey).toBe('test-api-key')
      expect(result.url).toBe('https://example.com?key=test-api-key')
      expect(result.regularParam).toBe('Base URL is: {{BASE_URL}}') // Should not be resolved
    })

    it('should resolve explicit environment variables', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            explicitEnv: '{{BASE_URL}}', // Full string is just an env var
          },
        },
        inputs: {
          explicitEnv: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.explicitEnv).toBe('https://api.example.com')
    })

    it('should not resolve environment variables in regular contexts', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            regularParam: 'Value with {{API_KEY}} embedded',
          },
        },
        inputs: {
          regularParam: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      // Environment variable should not be resolved in regular contexts
      expect(result.regularParam).toBe('Value with {{API_KEY}} embedded')
    })
  })

  describe('Table Cell Resolution', () => {
    it('should resolve variable references in table cells', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            tableParam: [
              {
                id: 'row1',
                cells: {
                  Key: 'stringKey',
                  Value: '<variable.stringVar>',
                },
              },
              {
                id: 'row2',
                cells: {
                  Key: 'numberKey',
                  Value: '<variable.numberVar>',
                },
              },
              {
                id: 'row3',
                cells: {
                  Key: 'plainKey',
                  Value: '<variable.plainVar>',
                },
              },
            ],
          },
        },
        inputs: {
          tableParam: 'json',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.tableParam[0].cells.Value).toBe('Hello') // string var
      expect(result.tableParam[1].cells.Value).toBe(42) // number var - correctly typed
      expect(result.tableParam[2].cells.Value).toBe('Raw text without quotes') // plain var
    })

    it('should resolve block references in table cells', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            tableParam: [
              {
                id: 'row1',
                cells: {
                  Key: 'inputKey',
                  Value: '<start.response.input>',
                },
              },
              {
                id: 'row2',
                cells: {
                  Key: 'resultKey',
                  Value: '<function-block.response.result>',
                },
              },
            ],
          },
        },
        inputs: {
          tableParam: 'json',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.tableParam[0].cells.Value).toBe('Hello World')
      expect(result.tableParam[1].cells.Value).toBe('42') // Result values come as strings
    })

    it('should handle interpolated variable references in table cells', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            tableParam: [
              {
                id: 'row1',
                cells: {
                  Key: 'greeting',
                  Value: 'Hello, <variable.stringVar>!',
                },
              },
            ],
          },
        },
        inputs: {
          tableParam: 'json',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.tableParam[0].cells.Value).toBe('Hello, Hello!')
    })
  })

  describe('Special Block Types', () => {
    it('should handle code input for function blocks', () => {
      const block: SerializedBlock = {
        id: 'code-block',
        metadata: { id: 'function', name: 'Code Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'function',
          params: {
            code: 'const name = "<variable.stringVar>";\nconst num = <variable.numberVar>;\nreturn { name, num };',
          },
        },
        inputs: {
          code: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      // String should be quoted in code context
      expect(result.code).toContain('const name = "\"Hello\"";')
      // Number should not be quoted
      expect(result.code).toContain('const num = 42;')
    })

    it('should handle body input for API blocks', () => {
      const block: SerializedBlock = {
        id: 'api-block',
        metadata: { id: 'api', name: 'API Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'api',
          params: {
            body: '{ "name": "<variable.stringVar>", "value": <variable.numberVar> }',
          },
        },
        inputs: {
          body: 'json',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      // Body should be parsed into an object
      expect(result.body).toEqual({
        name: 'Hello',
        value: 42,
      })
    })

    it('should handle conditions parameter for condition blocks', () => {
      const block: SerializedBlock = {
        id: 'condition-block',
        metadata: { id: 'condition', name: 'Condition Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'condition',
          params: {
            conditions: '<start.response.input> === "Hello World"',
          },
        },
        inputs: {
          conditions: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      // Conditions should be passed through without parsing for condition blocks
      expect(result.conditions).toBe('<start.response.input> === "Hello World"')
    })
  })

  describe('findVariableByName Helper', () => {
    it('should find variables with exact name match', () => {
      const block: SerializedBlock = {
        id: 'test-block',
        metadata: { id: 'generic', name: 'Test Block' },
        position: { x: 0, y: 0 },
        config: {
          tool: 'generic',
          params: {
            param1: '<variable.stringVar>',
            param2: '<variable.numberVar>',
          },
        },
        inputs: {
          param1: 'string',
          param2: 'string',
        },
        outputs: {},
        enabled: true,
      }

      const result = resolver.resolveInputs(block, mockContext)

      expect(result.param1).toBe('Hello')
      expect(result.param2).toBe(42)
    })
  })
})
