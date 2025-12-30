import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { EnvResolver } from './env'
import type { ResolutionContext } from './reference'

vi.mock('@sim/logger', () => loggerMock)

/**
 * Creates a minimal ResolutionContext for testing.
 * The EnvResolver only uses context.executionContext.environmentVariables.
 */
function createTestContext(environmentVariables: Record<string, string>): ResolutionContext {
  return {
    executionContext: { environmentVariables },
    executionState: {},
    currentNodeId: 'test-node',
  } as ResolutionContext
}

describe('EnvResolver', () => {
  describe('canResolve', () => {
    it.concurrent('should return true for valid env var references', () => {
      const resolver = new EnvResolver()
      expect(resolver.canResolve('{{API_KEY}}')).toBe(true)
      expect(resolver.canResolve('{{DATABASE_URL}}')).toBe(true)
      expect(resolver.canResolve('{{MY_VAR}}')).toBe(true)
    })

    it.concurrent('should return true for env vars with underscores', () => {
      const resolver = new EnvResolver()
      expect(resolver.canResolve('{{MY_SECRET_KEY}}')).toBe(true)
      expect(resolver.canResolve('{{SOME_LONG_VARIABLE_NAME}}')).toBe(true)
    })

    it.concurrent('should return true for env vars with numbers', () => {
      const resolver = new EnvResolver()
      expect(resolver.canResolve('{{API_KEY_2}}')).toBe(true)
      expect(resolver.canResolve('{{V2_CONFIG}}')).toBe(true)
    })

    it.concurrent('should return false for non-env var references', () => {
      const resolver = new EnvResolver()
      expect(resolver.canResolve('<block.output>')).toBe(false)
      expect(resolver.canResolve('<variable.myvar>')).toBe(false)
      expect(resolver.canResolve('<loop.index>')).toBe(false)
      expect(resolver.canResolve('plain text')).toBe(false)
      expect(resolver.canResolve('{API_KEY}')).toBe(false)
      expect(resolver.canResolve('{{API_KEY}')).toBe(false)
      expect(resolver.canResolve('{API_KEY}}')).toBe(false)
    })
  })

  describe('resolve', () => {
    it.concurrent('should resolve existing environment variable', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({ API_KEY: 'secret-api-key' })

      const result = resolver.resolve('{{API_KEY}}', ctx)
      expect(result).toBe('secret-api-key')
    })

    it.concurrent('should resolve multiple different environment variables', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({
        DATABASE_URL: 'postgres://localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        SECRET_KEY: 'super-secret',
      })

      expect(resolver.resolve('{{DATABASE_URL}}', ctx)).toBe('postgres://localhost:5432/db')
      expect(resolver.resolve('{{REDIS_URL}}', ctx)).toBe('redis://localhost:6379')
      expect(resolver.resolve('{{SECRET_KEY}}', ctx)).toBe('super-secret')
    })

    it.concurrent('should return original reference for non-existent variable', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({ EXISTING: 'value' })

      const result = resolver.resolve('{{NON_EXISTENT}}', ctx)
      expect(result).toBe('{{NON_EXISTENT}}')
    })

    it.concurrent('should handle empty string value', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({ EMPTY_VAR: '' })

      const result = resolver.resolve('{{EMPTY_VAR}}', ctx)
      expect(result).toBe('')
    })

    it.concurrent('should handle value with special characters', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({
        SPECIAL: 'value with spaces & special chars: !@#$%^&*()',
      })

      const result = resolver.resolve('{{SPECIAL}}', ctx)
      expect(result).toBe('value with spaces & special chars: !@#$%^&*()')
    })

    it.concurrent('should handle JSON string values', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({
        JSON_CONFIG: '{"key": "value", "nested": {"a": 1}}',
      })

      const result = resolver.resolve('{{JSON_CONFIG}}', ctx)
      expect(result).toBe('{"key": "value", "nested": {"a": 1}}')
    })

    it.concurrent('should handle empty environment variables object', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({})

      const result = resolver.resolve('{{ANY_VAR}}', ctx)
      expect(result).toBe('{{ANY_VAR}}')
    })

    it.concurrent('should handle undefined environmentVariables gracefully', () => {
      const resolver = new EnvResolver()
      const ctx = {
        executionContext: {},
        executionState: {},
        currentNodeId: 'test-node',
      } as ResolutionContext

      const result = resolver.resolve('{{API_KEY}}', ctx)
      expect(result).toBe('{{API_KEY}}')
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle variable names with consecutive underscores', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({ MY__VAR: 'double underscore' })

      expect(resolver.canResolve('{{MY__VAR}}')).toBe(true)
      expect(resolver.resolve('{{MY__VAR}}', ctx)).toBe('double underscore')
    })

    it.concurrent('should handle single character variable names', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({ X: 'single' })

      expect(resolver.canResolve('{{X}}')).toBe(true)
      expect(resolver.resolve('{{X}}', ctx)).toBe('single')
    })

    it.concurrent('should handle very long variable names', () => {
      const resolver = new EnvResolver()
      const longName = 'A'.repeat(100)
      const ctx = createTestContext({ [longName]: 'long name value' })

      expect(resolver.canResolve(`{{${longName}}}`)).toBe(true)
      expect(resolver.resolve(`{{${longName}}}`, ctx)).toBe('long name value')
    })

    it.concurrent('should handle value containing mustache-like syntax', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({
        TEMPLATE: 'Hello {{name}}!',
      })

      const result = resolver.resolve('{{TEMPLATE}}', ctx)
      expect(result).toBe('Hello {{name}}!')
    })

    it.concurrent('should handle multiline values', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({
        MULTILINE: 'line1\nline2\nline3',
      })

      const result = resolver.resolve('{{MULTILINE}}', ctx)
      expect(result).toBe('line1\nline2\nline3')
    })
  })
})
