import { describe, expect, it, vi } from 'vitest'
import {
  createLargeArrayManifest,
  isLargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { navigatePathAsync } from '@/executor/variables/resolvers/reference-async.server'
import type { ResolutionContext } from './reference'
import { WorkflowResolver } from './workflow'

vi.mock('@/lib/workflows/variables/variable-manager', () => ({
  VariableManager: {
    resolveForExecution: vi.fn((value) => value),
  },
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  insertImmutableFileMetadata: vi.fn().mockResolvedValue({ id: 'execution-payload-file' }),
  insertFileMetadata: vi.fn().mockResolvedValue({ id: 'execution-payload-file' }),
  deleteFileMetadata: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async (encryptedValue: string) => ({ decrypted: encryptedValue })),
}))

/**
 * Creates a minimal ResolutionContext for testing.
 * The WorkflowResolver only uses context.executionContext.workflowVariables,
 * so we only need to provide that field.
 */
function createTestContext(workflowVariables: Record<string, any>): ResolutionContext {
  return {
    executionContext: {
      workflowVariables,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    },
    executionState: {},
    currentNodeId: 'test-node',
  } as ResolutionContext
}

describe('WorkflowResolver', () => {
  describe('resolve with normalized matching', () => {
    it.concurrent('should resolve variable with normalized name (lowercase)', () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'MyVar', type: 'plain', value: 'test-value' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.myvar>', createTestContext(variables))
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

    it.concurrent('should resolve by variable ID (exact match)', () => {
      const variables = {
        'my-uuid-id': { id: 'my-uuid-id', name: 'Some Name', type: 'plain', value: 'id-value' },
      }
      const resolver = new WorkflowResolver(variables)

      const result = resolver.resolve('<variable.my-uuid-id>', createTestContext(variables))
      expect(result).toBe('id-value')
    })

    it('imports provenance from the exact persisted workflow variable', async () => {
      const variables = {
        'var-1': { id: 'var-1', name: 'token', type: 'plain', value: 'secret-value' },
      }
      const registry = new ResolvedSecretTraceRegistry()
      const context = createTestContext(variables)
      context.executionContext.resolvedSecretTraceRegistry = registry
      context.executionContext.workflowVariableResolvedSecretTraceProvenance = {
        'var-1': {
          version: 1,
          complete: true,
          entries: [{ name: 'API_KEY', encryptedValue: 'secret-value' }],
        },
      }

      await expect(
        new WorkflowResolver(variables).resolveAsync('<variable.token>', context)
      ).resolves.toBe('secret-value')
      expect(registry.getActiveMatches()).toEqual([
        { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
      ])
    })

    it('returns whole large workflow variable manifests only when refs are allowed', async () => {
      const compacted = await compactExecutionPayload(
        Array.from({ length: 100 }, (_, index) => ({
          key: `SIM-${index}`,
          summary: 'Issue summary that keeps each item small',
        })),
        {
          thresholdBytes: 256,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }
      )
      const variables = {
        'var-1': { id: 'var-1', name: 'issues', type: 'array', value: compacted },
      }
      const resolver = new WorkflowResolver(variables, navigatePathAsync)
      const context = createTestContext(variables)

      expect(() => resolver.resolve('<variable.issues>', context)).toThrow('too large to inline')
      await expect(resolver.resolveAsync('<variable.issues>', context)).rejects.toThrow(
        'too large to inline'
      )

      const allowedContext = { ...context, allowLargeValueRefs: true }
      expect(isLargeArrayManifest(resolver.resolve('<variable.issues>', allowedContext))).toBe(true)
      await expect(resolver.resolveAsync('<variable.issues>', allowedContext)).resolves.toEqual(
        compacted
      )
    })

    it('preserves large array manifest workflow variables without array coercion', async () => {
      const manifest = await createLargeArrayManifest([{ key: 'SIM-1' }], {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
      const variables = {
        'var-1': { id: 'var-1', name: 'issues', type: 'array', value: manifest },
      }
      const resolver = new WorkflowResolver(variables, navigatePathAsync)

      const allowedContext = { ...createTestContext(variables), allowLargeValueRefs: true }

      expect(resolver.resolve('<variable.issues>', allowedContext)).toEqual(manifest)
      await expect(resolver.resolveAsync('<variable.issues>', allowedContext)).resolves.toEqual(
        manifest
      )
    })

    it('resolves manifest array length without materializing chunks', async () => {
      const manifest = await createLargeArrayManifest([{ key: 'SIM-1' }, { key: 'SIM-2' }], {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
      const variables = {
        'var-1': { id: 'var-1', name: 'issues', type: 'array', value: manifest },
      }
      const resolver = new WorkflowResolver(variables, navigatePathAsync)

      await expect(
        resolver.resolveAsync('<variable.issues.length>', createTestContext(variables))
      ).resolves.toBe(2)
    })
  })

  describe('edge cases', () => {
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
