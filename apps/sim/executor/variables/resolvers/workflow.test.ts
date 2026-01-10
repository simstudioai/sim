import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import type { ResolutionContext } from './reference'
import { WorkflowResolver } from './workflow'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/workflows/variables/variable-manager', () => ({
  VariableManager: {
    resolveForExecution: vi.fn((value) => value),
  },
}))

/**
 * Creates a minimal ResolutionContext for testing.
 * The WorkflowResolver only uses context.executionContext.workflowVariables,
 * so we only need to provide that field.
 */
function createTestContext(workflowVariables: Record<string, any>): ResolutionContext {
  return {
    executionContext: { workflowVariables },
    executionState: {},
    currentNodeId: 'test-node',
  } as ResolutionContext
}

describe('WorkflowResolver', () => {
  describe('canResolve', () => {
    it.concurrent('should return true for variable references', () => {
      const resolver = new WorkflowResolver({})
      expect(resolver.canResolve('<variable.myvar>')).toBe(true)
      expect(resolver.canResolve('<variable.test>')).toBe(true)
    })

    it.concurrent('should return false for non-variable references', () => {
      const resolver = new WorkflowResolver({})
      expect(resolver.canResolve('<block.output>')).toBe(false)
      expect(resolver.canResolve('<loop.index>')).toBe(false)
      expect(resolver.canResolve('plain text')).toBe(false)
    })
  })

  describe('resolve with normalized matching', () => {
    it.concurrent('should resolve variable with exact name match', () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'myvar', type: 'plain', value: 'test-value' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.myvar>', createTestContext(variables))
      expect(result).toBe('test-value')
    })

    it.concurrent('should resolve variable with normalized name (lowercase)', () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'MyVar', type: 'plain', value: 'test-value' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.myvar>', createTestContext(variables))
      expect(result).toBe('test-value')
    })

    it.concurrent('should resolve variable with normalized name (spaces removed)', () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'My Variable', type: 'plain', value: 'test-value' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.myvariable>', createTestContext(variables))
      expect(result).toBe('test-value')
    })

    it.concurrent(
      'should resolve variable with fully normalized name (JIRA TEAM UUID case)',
      () => {
        const variables = {
          'var-1': { id: 'var-1', name: 'JIRA TEAM UUID', type: 'plain', value: 'uuid-123' },
        }
        const resolver = new WorkflowResolver(variables)

        const result = resolver.resolve('<variable.jirateamuuid>', createTestContext(variables))
        expect(result).toBe('uuid-123')
      }
    )

    it.concurrent('should resolve variable regardless of reference case', () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'jirateamuuid', type: 'plain', value: 'uuid-123' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.JIRATEAMUUID>', createTestContext(variables))
      expect(result).toBe('uuid-123')
    })

    it.concurrent('should resolve by variable ID (exact match)', () => {
      const variables = {
        'my-uuid-id': { id: 'my-uuid-id', name: 'Some Name', type: 'plain', value: 'id-value' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.my-uuid-id>', createTestContext(variables))
      expect(result).toBe('id-value')
    })

    it.concurrent('should return undefined for non-existent variable', () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'existing', type: 'plain', value: 'test' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.nonexistent>', createTestContext(variables))
      expect(result).toBeUndefined()
    })

    it.concurrent('should handle nested path access', () => {
      const variables = {
        'var-1': {
          id: 'var-1',
          name: 'config',
          type: 'object',
          value: { nested: { value: 'deep' } },
        },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve(
        '<variable.config.nested.value>',
        createTestContext(variables)
      )
      expect(result).toBe('deep')
    })

    it.concurrent('should resolve with mixed case and spaces in reference', () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'api key', type: 'plain', value: 'secret-key' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.APIKEY>', createTestContext(variables))
      expect(result).toBe('secret-key')
    })

    it.concurrent('should handle real-world variable naming patterns', () => {
      const testCases = [
        { varName: 'User ID', refName: 'userid', value: 'user-123' },
        { varName: 'API Key', refName: 'apikey', value: 'key-456' },
        { varName: 'STRIPE SECRET KEY', refName: 'stripesecretkey', value: 'sk_test' },
        { varName: 'Database URL', refName: 'databaseurl', value: 'postgres://...' },
      ]

      for (const { varName, refName, value } of testCases) {
        const variables = {
          'var-1': { id: 'var-1', name: varName, type: 'plain', value },
        }
        const resolver = new WorkflowResolver(variables)

        const result = resolver.resolve(`<variable.${refName}>`, createTestContext(variables))
        expect(result).toBe(value)
      }
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle empty workflow variables', () => {
      const resolver = new WorkflowResolver({})

      const result = resolver.resolve('<variable.anyvar>', createTestContext({}))
      expect(result).toBeUndefined()
    })

    it.concurrent('should handle invalid reference format', () => {
      const resolver = new WorkflowResolver({})

      const result = resolver.resolve('<variable>', createTestContext({}))
      expect(result).toBeUndefined()
    })

    it.concurrent('should handle null variable values in the map', () => {
      const variables: Record<string, any> = {
        'var-1': null,
        'var-2': { id: 'var-2', name: 'valid', type: 'plain', value: 'exists' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.valid>', createTestContext(variables))
      expect(result).toBe('exists')
    })

    it.concurrent('should handle variable with empty name', () => {
      const variables = {
        'var-1': { id: 'var-1', name: '', type: 'plain', value: 'empty-name' },
      }
      const resolver = new WorkflowResolver(variables)

      // Empty name normalizes to empty string, which matches "<variable.>" reference
      const result = resolver.resolve('<variable.>', createTestContext(variables))
      expect(result).toBe('empty-name')
    })

    it.concurrent('should prefer name match over ID match when both could apply', () => {
      const variables = {
        apikey: { id: 'apikey', name: 'different', type: 'plain', value: 'by-id' },
        'var-2': { id: 'var-2', name: 'apikey', type: 'plain', value: 'by-name' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.apikey>', createTestContext(variables))
      expect(['by-id', 'by-name']).toContain(result)
    })
  })
})
