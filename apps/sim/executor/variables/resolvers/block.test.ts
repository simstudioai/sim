import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { getAllBlocks, getBlock, getBlockByToolName } from '@/blocks/registry'
import { ExecutionState } from '@/executor/execution/state'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { navigatePathAsync } from '@/executor/variables/resolvers/reference-async.server'
import { BlockResolver } from './block'
import { RESOLVED_EMPTY, type ResolutionContext } from './reference'

const mockGetBlock = getBlock as Mock
const mockGetAllBlocks = getAllBlocks as Mock
const mockGetBlockByToolName = getBlockByToolName as Mock
mockGetBlock.mockImplementation((type: string) => MOCK_BLOCKS[type] ?? undefined)
mockGetAllBlocks.mockImplementation(() => Object.values(MOCK_BLOCKS))
mockGetBlockByToolName.mockImplementation(() => undefined)

encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
  decrypted: encryptedValue,
}))
uploadsMetadataMockFns.mockInsertImmutableFileMetadata.mockResolvedValue({
  id: 'execution-payload-file',
})
uploadsMetadataMockFns.mockInsertFileMetadata.mockResolvedValue({ id: 'execution-payload-file' })
uploadsMetadataMockFns.mockDeleteFileMetadata.mockResolvedValue(undefined)

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

/**
 * Minimal block configs providing only the fields needed by getBlockSchema / getEffectiveBlockOutputs.
 * This avoids loading all 200+ block definition files via the real registry.
 * Uses vi.hoisted() so the mock data is available when vi.mock factories execute.
 */
const MOCK_BLOCKS = vi.hoisted(
  () =>
    ({
      start_trigger: {
        type: 'start_trigger',
        category: 'triggers',
        subBlocks: [{ id: 'inputFormat', type: 'input-format' }],
        outputs: {},
        triggers: { enabled: true, available: ['chat', 'manual', 'api'] },
      },
      function: {
        type: 'function',
        category: 'tools',
        subBlocks: [],
        outputs: {
          result: {
            type: 'json',
            description: 'Return value from the executed JavaScript function',
          },
          stdout: { type: 'string', description: 'Console log output' },
        },
      },
      response: {
        type: 'response',
        category: 'tools',
        subBlocks: [],
        outputs: {
          data: { type: 'json', description: 'Response data' },
          status: { type: 'number', description: 'HTTP status code' },
          headers: { type: 'json', description: 'Response headers' },
        },
      },
      workflow: {
        type: 'workflow',
        category: 'tools',
        subBlocks: [],
        outputs: {
          success: { type: 'boolean', description: 'Execution success status' },
          childWorkflowName: { type: 'string', description: 'Child workflow name' },
          childWorkflowId: { type: 'string', description: 'Child workflow ID' },
          result: { type: 'json', description: 'Workflow execution result' },
          error: { type: 'string', description: 'Error message' },
          childTraceSpans: {
            type: 'json',
            description: 'Child workflow trace spans',
            hiddenFromDisplay: true,
          },
        },
      },
      workflow_input: {
        type: 'workflow_input',
        category: 'tools',
        subBlocks: [],
        outputs: {
          success: { type: 'boolean', description: 'Execution success status' },
          childWorkflowName: { type: 'string', description: 'Child workflow name' },
          childWorkflowId: { type: 'string', description: 'Child workflow ID' },
          result: { type: 'json', description: 'Workflow execution result' },
          error: { type: 'string', description: 'Error message' },
          childTraceSpans: {
            type: 'json',
            description: 'Child workflow trace spans',
            hiddenFromDisplay: true,
          },
        },
      },
      human_in_the_loop: {
        type: 'human_in_the_loop',
        category: 'tools',
        subBlocks: [],
        outputs: {
          url: { type: 'string', description: 'Resume UI URL' },
          resumeEndpoint: { type: 'string', description: 'Resume API endpoint URL' },
          response: {
            type: 'json',
            description: 'Display data shown to the approver',
            hiddenFromDisplay: true,
          },
          submission: {
            type: 'json',
            description: 'Form submission data',
            hiddenFromDisplay: true,
          },
          resumeInput: {
            type: 'json',
            description: 'Raw input data submitted when resuming',
            hiddenFromDisplay: true,
          },
          submittedAt: {
            type: 'string',
            description: 'ISO timestamp when the workflow was resumed',
          },
        },
      },
      agent: {
        type: 'agent',
        category: 'tools',
        subBlocks: [],
        outputs: {
          response: { type: 'json', description: 'Agent response' },
          tokens: { type: 'json', description: 'Token usage' },
        },
      },
    }) as Record<string, any>
)

function createTestWorkflow(
  blocks: Array<{
    id: string
    name?: string
    type?: string
    outputs?: Record<string, any>
  }> = [],
  subflows: { loops?: Record<string, any>; parallels?: Record<string, any> } = {}
) {
  return {
    version: '1.0',
    blocks: blocks.map((b) => ({
      id: b.id,
      position: { x: 0, y: 0 },
      config: { tool: b.type ?? 'function', params: {} },
      inputs: {},
      outputs: b.outputs ?? {},
      metadata: { id: b.type ?? 'function', name: b.name ?? b.id },
      enabled: true,
    })),
    connections: [],
    loops: subflows.loops ?? {},
    parallels: subflows.parallels ?? {},
  }
}

/**
 * Creates a test ResolutionContext with block outputs.
 */
function createTestContext(
  currentNodeId: string,
  blockOutputs: Record<string, any> = {},
  contextBlockStates?: Map<string, { output: any }>,
  parallelBlockMapping?: Map<string, any>
): ResolutionContext {
  const state = new ExecutionState()
  for (const [blockId, output] of Object.entries(blockOutputs)) {
    state.setBlockOutput(blockId, output)
  }

  return {
    executionContext: {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      blockStates: contextBlockStates ?? new Map(),
      parallelBlockMapping,
    },
    executionState: state,
    currentNodeId,
  } as unknown as ResolutionContext
}

describe('BlockResolver', () => {
  describe('resolve', () => {
    it.concurrent('should resolve block output by name', () => {
      const workflow = createTestWorkflow([{ id: 'block-123', name: 'My Source Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'block-123': { message: 'hello' },
      })

      expect(resolver.resolve('<mysourceblock>', ctx)).toEqual({ message: 'hello' })
      expect(resolver.resolve('<My Source Block>', ctx)).toEqual({ message: 'hello' })
    })

    it.concurrent('should resolve blocks whose names contain dots via dot-stripped names', () => {
      const workflow = createTestWorkflow([{ id: 'block-dot', name: 'Hunter.io 1' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'block-dot': { email: 'jane@acme.com', score: 92 },
      })

      expect(resolver.resolve('<hunterio1.email>', ctx)).toBe('jane@acme.com')
      expect(resolver.resolve('<hunterio1.score>', ctx)).toBe(92)
    })

    it.concurrent('should keep dot-free names as the reference target on legacy collisions', () => {
      const blocks = [
        { id: 'block-dotted', name: 'Hunter.io 1' },
        { id: 'block-plain', name: 'Hunterio 1' },
      ]
      const ctx = createTestContext('current', {
        'block-dotted': { email: 'dotted@acme.com' },
        'block-plain': { email: 'plain@acme.com' },
      })

      const resolver = new BlockResolver(createTestWorkflow(blocks))
      expect(resolver.resolve('<hunterio1.email>', ctx)).toBe('plain@acme.com')

      const reversedResolver = new BlockResolver(createTestWorkflow([...blocks].reverse()))
      expect(reversedResolver.resolve('<hunterio1.email>', ctx)).toBe('plain@acme.com')
    })

    it('does not fall back to unscoped block state inside cloned subflow branches', () => {
      const workflow = createTestWorkflow([{ id: 'source' }], {
        parallels: { 'parallel-1': { id: 'parallel-1', nodes: ['source'] } },
      })
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext(
        'consumer__clone-inner__obranch-1₍0₎',
        {},
        new Map([['source', { output: { result: 'branch-0' } }]])
      )

      expect(resolver.resolve('<source.result>', ctx)).toBe(RESOLVED_EMPTY)
    })

    it('allows cloned subflows to resolve top-level upstream block state', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext(
        'consumer__clone-inner__obranch-1₍0₎',
        {},
        new Map([['source', { output: { result: 'global' } }]])
      )

      expect(resolver.resolve('<source.result>', ctx)).toBe('global')
    })

    it('uses parallel block mappings to resolve cloned subflow outputs in later batches', () => {
      const workflow = createTestWorkflow(
        [
          { id: 'nested-loop', name: 'Nested Loop' },
          { id: 'consumer', name: 'Consumer' },
        ],
        {
          loops: { 'nested-loop': { id: 'nested-loop', nodes: ['loop-task'] } },
          parallels: { 'parallel-1': { id: 'parallel-1', nodes: ['nested-loop', 'consumer'] } },
        }
      )
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext(
        'consumer₍0₎',
        {
          'nested-loop': { results: ['branch-0'] },
          'nested-loop__obranch-2': { results: ['branch-2'] },
        },
        undefined,
        new Map([
          [
            'consumer₍0₎',
            { originalBlockId: 'consumer', parallelId: 'parallel-1', iterationIndex: 2 },
          ],
        ])
      )

      expect(resolver.resolve('<nestedloop.results>', ctx)).toEqual(['branch-2'])
    })

    it('uses outer branch suffix over inner parallel mappings for cloned subflow outputs', () => {
      const workflow = createTestWorkflow(
        [
          { id: 'sibling-loop', name: 'Sibling Loop' },
          { id: 'inner-task', name: 'Inner Task' },
        ],
        {
          loops: { 'sibling-loop': { id: 'sibling-loop', nodes: ['loop-task'] } },
          parallels: {
            'outer-parallel': { id: 'outer-parallel', nodes: ['sibling-loop', 'inner-parallel'] },
            'inner-parallel': { id: 'inner-parallel', nodes: ['inner-task'] },
          },
        }
      )
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext(
        'inner-task__clone-inner__obranch-2₍0₎',
        {
          'sibling-loop__obranch-1': { results: ['inner-branch-1'] },
          'sibling-loop__obranch-2': { results: ['outer-branch-2'] },
        },
        undefined,
        new Map([
          [
            'inner-task__clone-inner__obranch-2₍0₎',
            { originalBlockId: 'inner-task', parallelId: 'inner-parallel', iterationIndex: 1 },
          ],
        ])
      )

      expect(resolver.resolve('<siblingloop.results>', ctx)).toEqual(['outer-branch-2'])
    })

    it('should resolve nested scalar paths inside compacted block references', async () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const compacted = await compactExecutionPayload(
        {
          user: { profile: { name: 'Alice' } },
          items: Array.from({ length: 100 }, (_, index) => ({ id: index })),
        },
        {
          thresholdBytes: 64,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }
      )
      const ctx = createTestContext('current', { source: compacted })

      expect(resolver.resolve('<source.user.profile.name>', ctx)).toBe('Alice')
      expect(resolver.resolve('<source.items[1].id>', ctx)).toBe(1)
      expect(() => resolver.resolve('<source>', ctx)).toThrow('too large to inline')
    })

    it('should reject full container references that contain compacted children', async () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const compacted = await compactExecutionPayload(
        {
          metadata: { id: 'event-1' },
          attachment: { body: 'x'.repeat(2048) },
        },
        { thresholdBytes: 256, preserveRoot: true }
      )
      const ctx = createTestContext('current', { source: compacted })

      expect(resolver.resolve('<source.metadata.id>', ctx)).toBe('event-1')
      expect(() => resolver.resolve('<source>', ctx)).toThrow('too large to inline')
      expect(() => resolver.resolve('<source.attachment>', ctx)).toThrow('too large to inline')
    })

    it.concurrent('should resolve array index in path', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      })

      expect(resolver.resolve('<source.items.0>', ctx)).toEqual({ id: 1 })
      expect(resolver.resolve('<source.items.1.id>', ctx)).toBe(2)
    })

    it.concurrent(
      'should return RESOLVED_EMPTY for non-existent path when no schema defined',
      () => {
        const workflow = createTestWorkflow([{ id: 'source', type: 'unknown_block_type' }])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          source: { existing: 'value' },
        })

        expect(resolver.resolve('<source.nonexistent>', ctx)).toBe(RESOLVED_EMPTY)
      }
    )

    it.concurrent('should throw error for path not in output schema', () => {
      const workflow = createTestWorkflow([
        {
          id: 'source',
          type: 'start_trigger',
        },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { input: 'value' },
      })

      expect(() => resolver.resolve('<source.invalidField>', ctx)).toThrow(
        /"invalidField" doesn't exist on block "source"/
      )
      expect(() => resolver.resolve('<source.invalidField>', ctx)).toThrow(/Available fields:/)
    })

    it.concurrent('should return RESOLVED_EMPTY for path in schema but missing in data', () => {
      const workflow = createTestWorkflow([
        {
          id: 'source',
          type: 'function',
        },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        source: { stdout: 'log output' },
      })

      expect(resolver.resolve('<source.stdout>', ctx)).toBe('log output')
      expect(resolver.resolve('<source.result>', ctx)).toBe(RESOLVED_EMPTY)
    })

    describe('implicit error output', () => {
      it.concurrent('resolves the message on a failed block', () => {
        const workflow = createTestWorkflow([{ id: 'guard', type: 'function' }])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          guard: { error: 'Guard rejected the payload' },
        })

        expect(resolver.resolve('<guard.error>', ctx)).toBe('Guard rejected the payload')
      })

      it.concurrent('still rejects an unrelated unknown field', () => {
        const workflow = createTestWorkflow([{ id: 'guard', type: 'function' }])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          guard: { result: { ok: true } },
        })

        expect(() => resolver.resolve('<guard.errors>', ctx)).toThrow(
          '"errors" doesn\'t exist on block "guard". Available fields: result, stdout'
        )
        expect(() => resolver.resolve('<guard.error.code>', ctx)).toThrow(
          /"error.code" doesn't exist on block "guard"/
        )
      })
    })

    it.concurrent(
      'should allow hiddenFromDisplay fields for pre-execution schema validation',
      () => {
        const workflow = createTestWorkflow([
          {
            id: 'workflow-block',
            name: 'Workflow',
            type: 'workflow',
          },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {})

        expect(resolver.resolve('<workflow.childTraceSpans>', ctx)).toBe(RESOLVED_EMPTY)
      }
    )

    it.concurrent('should return RESOLVED_EMPTY for block in workflow that did not execute', () => {
      const workflow = createTestWorkflow([
        { id: 'start-block', name: 'Start', type: 'start_trigger' },
        { id: 'slack-block', name: 'Slack', type: 'slack_trigger' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'slack-block': { message: 'hello from slack' },
      })

      expect(resolver.resolve('<slack.message>', ctx)).toBe('hello from slack')
      expect(resolver.resolve('<start>', ctx)).toBe(RESOLVED_EMPTY)
      expect(resolver.resolve('<start.input>', ctx)).toBe(RESOLVED_EMPTY)
    })

    it.concurrent('should fall back to context blockStates', () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const contextStates = new Map([['source', { output: { fallback: true } }]])
      const ctx = createTestContext('current', {}, contextStates)

      expect(resolver.resolve('<source>', ctx)).toEqual({ fallback: true })
    })

    it('imports only the provenance attached to the referenced block state', async () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current')
      const registry = new ResolvedSecretTraceRegistry()
      ctx.executionContext.resolvedSecretTraceRegistry = registry
      ctx.executionState.setBlockOutput('source', { result: 'secret-value' }, 0, {
        version: 1,
        complete: true,
        entries: [{ name: 'API_KEY', encryptedValue: 'secret-value' }],
      })

      await expect(resolver.resolveAsync('<source.result>', ctx)).resolves.toBe('secret-value')
      expect(registry.getActiveMatches()).toEqual([
        { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
      ])
    })

    it('filters compacted block candidates against the exact selected leaf', async () => {
      const workflow = createTestWorkflow([{ id: 'source' }])
      const resolver = new BlockResolver(workflow, navigatePathAsync)
      const compacted = await compactExecutionPayload(
        {
          result: {
            huge: 'p'.repeat(9 * 1024 * 1024),
            public: 'ok',
            secret: 'secret-value',
          },
        },
        {
          preserveRoot: true,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }
      )
      expect(isLargeValueRef(compacted.result.huge)).toBe(true)
      const candidateProvenance = {
        version: 1 as const,
        complete: true,
        entries: [{ name: 'API_KEY', encryptedValue: 'secret-value' }],
      }

      const publicRegistry = new ResolvedSecretTraceRegistry()
      const publicContext = createTestContext('current')
      publicContext.inputPath = ['prompt']
      publicContext.executionContext.resolvedSecretTraceRegistry = publicRegistry
      publicContext.executionState.setBlockOutput('source', compacted, 0, candidateProvenance)

      await expect(resolver.resolveAsync('<source.result.public>', publicContext)).resolves.toBe(
        'ok'
      )
      expect(publicRegistry.isComplete()).toBe(true)
      expect(publicRegistry.getActiveMatches()).toEqual([])

      const secretRegistry = new ResolvedSecretTraceRegistry()
      const secretContext = createTestContext('current')
      secretContext.inputPath = ['prompt']
      secretContext.executionContext.resolvedSecretTraceRegistry = secretRegistry
      secretContext.executionState.setBlockOutput('source', compacted, 0, candidateProvenance)

      await expect(resolver.resolveAsync('<source.result.secret>', secretContext)).resolves.toBe(
        'secret-value'
      )
      expect(secretRegistry.isComplete()).toBe(true)
      expect(secretRegistry.getActiveMatches()).toEqual([
        { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
      ])
    })
  })

  describe('formatValueForBlock', () => {
    it.concurrent('should escape special characters for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('line1\nline2', 'condition')).toBe('"line1\\nline2"')
      expect(resolver.formatValueForBlock('quote "test"', 'condition')).toBe('"quote \\"test\\""')
      expect(resolver.formatValueForBlock('backslash \\', 'condition')).toBe('"backslash \\\\"')
      expect(resolver.formatValueForBlock('tab\there', 'condition')).toBe('"tab\there"')
    })

    it.concurrent('should escape the quotes it does not open for condition block', () => {
      // The author's quoting decides which literal this lands in, so escaping only the
      // double quote this wrapper opens leaves the other contexts breakable.
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock("' + evil() + '", 'condition')).toBe(
        '"\\\' + evil() + \\\'"'
      )
      expect(resolver.formatValueForBlock(`\${evil()}`, 'condition')).toBe(`"\\\${evil()}"`)
      expect(resolver.formatValueForBlock('`evil()`', 'condition')).toBe('"\\`evil()\\`"')
    })

    it.concurrent('should format object for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock({ key: 'value' }, 'condition')
      expect(result).toBe('{"key":"value"}')
    })

    it.concurrent('should format null/undefined for condition block', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock(null, 'condition')).toBe('null')
      expect(resolver.formatValueForBlock(undefined, 'condition')).toBe('undefined')
    })

    it.concurrent('should format string for function block (JSON escaped)', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      const result = resolver.formatValueForBlock('hello', 'function')
      expect(result).toBe('"hello"')
    })

    it.concurrent('should format string for response block (no quotes)', () => {
      const resolver = new BlockResolver(createTestWorkflow())
      expect(resolver.formatValueForBlock('plain text', 'response')).toBe('plain text')
    })
  })

  describe('Response block backwards compatibility', () => {
    it.concurrent(
      'should resolve old format (backwards compat): <responseBlock.response.data>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'response-block', name: 'Response', type: 'response' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'response-block': {
            data: { message: 'hello', userId: 123 },
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        })

        // Old format: <responseBlock.response.data> should strip 'response.' and resolve to data
        expect(resolver.resolve('<response.response.data>', ctx)).toEqual({
          message: 'hello',
          userId: 123,
        })
        expect(resolver.resolve('<response.response.data.message>', ctx)).toBe('hello')
        expect(resolver.resolve('<response.response.data.userId>', ctx)).toBe(123)
      }
    )

    it.concurrent(
      'should only strip response prefix for response block type, not other blocks',
      () => {
        // For non-response blocks, 'response' is a valid property name that should NOT be stripped
        const workflow = createTestWorkflow([{ id: 'agent-block', name: 'Agent', type: 'agent' }])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'agent-block': {
            response: { content: 'AI generated text' },
            tokens: { input: 100, output: 50 },
          },
        })

        // For agent blocks, 'response' is a valid property and should be accessed normally
        expect(resolver.resolve('<agent.response.content>', ctx)).toBe('AI generated text')
      }
    )

    it.concurrent(
      'should NOT strip response prefix if output actually has response key (edge case)',
      () => {
        // Edge case: What if a Response block somehow has a 'response' key in its output?
        // This shouldn't happen in practice, but if it does, we should respect it.
        const workflow = createTestWorkflow([
          { id: 'response-block', name: 'Response', type: 'response' },
        ])
        const resolver = new BlockResolver(workflow)
        // Hypothetical edge case where output has an actual 'response' property
        const ctx = createTestContext('current', {
          'response-block': {
            response: { legacyData: 'some value' },
            data: { newData: 'other value' },
          },
        })

        // Since output.response exists, we should NOT strip it - access the actual 'response' property
        expect(resolver.resolve('<response.response.legacyData>', ctx)).toBe('some value')
        expect(resolver.resolve('<response.data.newData>', ctx)).toBe('other value')
      }
    )
  })

  describe('Workflow block with child Response block backwards compatibility', () => {
    it.concurrent(
      'should resolve old format (backwards compat): <workflowBlock.result.response.data>',
      () => {
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'Child Workflow',
            result: {
              data: { userId: 456, name: 'Test User' },
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          },
        })

        // Old format: <workflowBlock.result.response.data> should strip 'response.' and resolve to result.data
        expect(resolver.resolve('<myworkflow.result.response.data>', ctx)).toEqual({
          userId: 456,
          name: 'Test User',
        })
        expect(resolver.resolve('<myworkflow.result.response.data.userId>', ctx)).toBe(456)
        expect(resolver.resolve('<myworkflow.result.response.data.name>', ctx)).toBe('Test User')
      }
    )

    it.concurrent('should not apply workflow backwards compat for non-workflow blocks', () => {
      // For non-workflow blocks, 'result.response' is a valid path that should NOT be modified
      const workflow = createTestWorkflow([
        { id: 'function-block', name: 'Function', type: 'function' },
      ])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', {
        'function-block': {
          result: {
            response: { apiData: 'test' },
            other: 'value',
          },
        },
      })

      // For function blocks, 'result.response' is a valid nested property
      expect(resolver.resolve('<function.result.response.apiData>', ctx)).toBe('test')
    })

    it.concurrent(
      'should NOT strip result.response if child actually has response property (edge case)',
      () => {
        // Edge case: Child workflow's final output legitimately has a 'response' property
        // (e.g., child ended with an Agent block that outputs response data)
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'My Workflow', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'Child Workflow',
            result: {
              // Child workflow ended with Agent block, not Response block
              content: 'AI generated text',
              response: { apiCallData: 'from external API' }, // legitimate 'response' property
            },
          },
        })

        // Since output.result.response exists, we should NOT strip it - access the actual property
        expect(resolver.resolve('<myworkflow.result.response.apiCallData>', ctx)).toBe(
          'from external API'
        )
        expect(resolver.resolve('<myworkflow.result.content>', ctx)).toBe('AI generated text')
      }
    )

    it.concurrent(
      'real-world scenario: accessing entire response object via <workflow1.result.response> (workflow type)',
      () => {
        const workflow = createTestWorkflow([
          { id: 'workflow-block', name: 'Workflow 1', type: 'workflow' },
        ])
        const resolver = new BlockResolver(workflow)

        // Child Response block output (new format - no wrapper)
        const ctx = createTestContext('current', {
          'workflow-block': {
            success: true,
            childWorkflowName: 'response-workflow-child-editor',
            result: {
              data: {
                s: 'example string',
                nums: [1, 2, 3],
                n: 42,
                obj: { key1: 'value1', key2: 'value2' },
              },
              status: 206,
              headers: { 'Content-Type': 'application/json', apple: 'banana' },
            },
          },
        })

        // OLD reference: <workflow1.result.response> should return the entire result object
        // This is used when the user wants to get data, status, headers all at once
        const response = resolver.resolve('<workflow1.result.response>', ctx)
        expect(response).toEqual({
          data: {
            s: 'example string',
            nums: [1, 2, 3],
            n: 42,
            obj: { key1: 'value1', key2: 'value2' },
          },
          status: 206,
          headers: { 'Content-Type': 'application/json', apple: 'banana' },
        })

        // Verify individual fields can be accessed from the returned object
        expect(response.status).toBe(206)
        expect(response.headers.apple).toBe('banana')
        expect(response.data.s).toBe('example string')
        expect(response.data.n).toBe(42)
        expect(response.data.nums).toEqual([1, 2, 3])
        expect(response.data.obj.key1).toBe('value1')
      }
    )
  })

  describe('edge cases', () => {
    it.concurrent('should handle case-insensitive block name matching', () => {
      const workflow = createTestWorkflow([{ id: 'block-1', name: 'My Block' }])
      const resolver = new BlockResolver(workflow)
      const ctx = createTestContext('current', { 'block-1': { data: 'test' } })

      expect(resolver.resolve('<MYBLOCK>', ctx)).toEqual({ data: 'test' })
      expect(resolver.resolve('<myblock>', ctx)).toEqual({ data: 'test' })
      expect(resolver.resolve('<MyBlock>', ctx)).toEqual({ data: 'test' })
    })
  })
})
