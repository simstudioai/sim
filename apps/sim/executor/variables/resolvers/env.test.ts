import { describe, expect, it } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { EnvResolver } from './env'
import type { ResolutionContext } from './reference'

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
  describe('resolve', () => {
    it('records only successful Secrets-tab substitutions', () => {
      const resolver = new EnvResolver()
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'API_KEY', plaintext: 'secret-api-key', encryptedValue: 'ciphertext' },
      ])
      const ctx = createTestContext({ API_KEY: 'secret-api-key' })
      ctx.executionContext.resolvedSecretTraceRegistry = registry

      expect(resolver.resolve('{{MISSING}}', ctx)).toBe('{{MISSING}}')
      expect(registry.getActiveMatches()).toEqual([])

      expect(resolver.resolve('{{API_KEY}}', ctx)).toBe('secret-api-key')
      expect(registry.getActiveMatches()).toEqual([
        { plaintext: 'secret-api-key', replacement: '{{API_KEY}}' },
      ])
    })

    it.concurrent('should return original reference for non-existent variable', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({ EXISTING: 'value' })

      const result = resolver.resolve('{{NON_EXISTENT}}', ctx)
      expect(result).toBe('{{NON_EXISTENT}}')
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle value containing mustache-like syntax', () => {
      const resolver = new EnvResolver()
      const ctx = createTestContext({
        TEMPLATE: 'Hello {{name}}!',
      })

      const result = resolver.resolve('{{TEMPLATE}}', ctx)
      expect(result).toBe('Hello {{name}}!')
    })
  })
})
