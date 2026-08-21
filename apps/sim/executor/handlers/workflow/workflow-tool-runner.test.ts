/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecute, mockDecryptSecret, mockEncryptSecret } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockEncryptSecret: vi.fn(),
}))

vi.mock('@/executor/handlers/workflow/workflow-handler', () => ({
  WorkflowBlockHandler: class {
    execute = mockExecute
  },
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: mockEncryptSecret,
}))

import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import { ExecutionState } from '@/executor/execution/state'
import type { PiiBlockOutputRedaction } from '@/executor/execution/types'
import { runWorkflowTool } from '@/executor/handlers/workflow/workflow-tool-runner'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { EnvResolver } from '@/executor/variables/resolvers/env'

const PII_POLICY: PiiBlockOutputRedaction = {
  enabled: true,
  entityTypes: ['EMAIL_ADDRESS'],
  language: 'en',
}

describe('runWorkflowTool execution context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecute.mockResolvedValue({ success: true })
  })

  it("runs the child under the invoking run's environment variables", async () => {
    await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1' } },
      { environmentVariables: { MY_API_KEY: 'secret-value' } }
    )

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.environmentVariables).toEqual({ MY_API_KEY: 'secret-value' })
  })

  it("forwards the invoking run's block-output redaction policy", async () => {
    await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1' } },
      { environmentVariables: {}, piiBlockOutputRedaction: PII_POLICY }
    )

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.piiBlockOutputRedaction).toBe(PII_POLICY)
  })

  it('ignores an env map smuggled in through the model-reachable _context bag', async () => {
    const modelSuppliedContext = {
      workspaceId: 'ws-1',
      environmentVariables: { MY_API_KEY: 'model-injected' },
    }

    await runWorkflowTool(
      { workflowId: 'wf-child', _context: modelSuppliedContext },
      { environmentVariables: { MY_API_KEY: 'trusted' } }
    )

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.environmentVariables).toEqual({ MY_API_KEY: 'trusted' })
  })

  it('accepts the execution principal only through trusted runner options', async () => {
    const trustedPrincipal = {
      kind: 'session' as const,
      userId: 'user-1',
      sessionId: 'session-1',
    }
    const modelSuppliedContext = {
      workspaceId: 'ws-1',
      principal: {
        kind: 'session' as const,
        userId: 'attacker',
        sessionId: 'attacker-session',
      },
    }

    await runWorkflowTool(
      { workflowId: 'wf-child', _context: modelSuppliedContext },
      { environmentVariables: {}, principal: trustedPrincipal }
    )

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.principal).toEqual(trustedPrincipal)
    expect(ctxArg.metadata.principal).toEqual(trustedPrincipal)
  })
})

const CHILD_SECRET = 'sk-live-7f2c9a41d8be4055b6c3'
const CHILD_SECRET_ENCRYPTED = 'encrypted:CHILD_API_KEY'
const SHORT_SECRET = 'hunter7'
const SHORT_SECRET_ENCRYPTED = 'encrypted:SHORT_KEY'
const SCOPE = { userId: 'user-1', workspaceId: 'ws-1' }

/**
 * Resolves `{{NAME}}` through the real {@link EnvResolver} against the synthetic child context,
 * reproducing how a child block records provenance for an environment variable it consumed.
 */
function resolveChildEnvReference(
  ctx: ExecutionContext,
  reference: string,
  inputPath: readonly string[]
): unknown {
  return new EnvResolver().resolve(reference, {
    executionContext: ctx,
    executionState: new ExecutionState(),
    currentNodeId: 'child-block',
    inputPath,
  })
}

describe('runWorkflowTool model-facing result provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => {
      if (encryptedValue === CHILD_SECRET_ENCRYPTED) return { decrypted: CHILD_SECRET }
      if (encryptedValue === SHORT_SECRET_ENCRYPTED) return { decrypted: SHORT_SECRET }
      throw new Error(`Unexpected encrypted value: ${encryptedValue}`)
    })
  })

  it('keeps a child-resolved environment secret out of the agent-visible tool result', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'CHILD_API_KEY',
          plaintext: CHILD_SECRET,
          encryptedValue: CHILD_SECRET_ENCRYPTED,
        },
      ],
      SCOPE
    )

    mockExecute.mockImplementation(async (ctx: ExecutionContext) => {
      const resolved = resolveChildEnvReference(ctx, '{{CHILD_API_KEY}}', ['child-block', 'apiKey'])
      return {
        success: true,
        childWorkflowName: 'Child',
        childWorkflowId: 'wf-child',
        result: { token: resolved },
        childTraceSpans: [
          {
            id: 'span-1',
            name: 'API',
            type: 'api',
            input: { authorization: `Bearer ${resolved}` },
          },
        ],
      }
    })

    const result = await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1', userId: 'user-1' } },
      {
        environmentVariables: { CHILD_API_KEY: CHILD_SECRET },
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(JSON.stringify(result.output)).toContain(CHILD_SECRET)

    const projected = projectToolResultForCopilot(result as ToolExecutionResult, registry)
    expect(JSON.stringify(projected)).not.toContain(CHILD_SECRET)
    expect(projected.output).toEqual({
      success: true,
      childWorkflowName: 'Child',
      childWorkflowId: 'wf-child',
      result: { token: '{{CHILD_API_KEY}}' },
      childTraceSpans: [
        {
          id: 'span-1',
          name: 'API',
          type: 'api',
          input: { authorization: 'Bearer {{CHILD_API_KEY}}' },
        },
      ],
    })
  })

  it('keeps a child-resolved environment secret out of a failed tool result', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'CHILD_API_KEY', plaintext: CHILD_SECRET, encryptedValue: CHILD_SECRET_ENCRYPTED }],
      SCOPE
    )

    mockExecute.mockImplementation(async (ctx: ExecutionContext) => {
      const resolved = resolveChildEnvReference(ctx, '{{CHILD_API_KEY}}', ['child-block', 'apiKey'])
      throw new Error(`Upstream rejected credential ${String(resolved)}`)
    })

    const result = await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1', userId: 'user-1' } },
      {
        environmentVariables: { CHILD_API_KEY: CHILD_SECRET },
        resolvedSecretTraceRegistry: registry,
      }
    )

    const projected = projectToolResultForCopilot(result as ToolExecutionResult, registry)
    expect(JSON.stringify(projected)).not.toContain(CHILD_SECRET)
    expect(projected.error).toContain('{{CHILD_API_KEY}}')
  })

  it('leaves an unrelated configured secret inert in the agent-visible tool result', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'CHILD_API_KEY',
          plaintext: CHILD_SECRET,
          encryptedValue: CHILD_SECRET_ENCRYPTED,
        },
      ],
      SCOPE
    )

    mockExecute.mockResolvedValue({ success: true, result: { note: 'no secret here' } })

    const result = await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1', userId: 'user-1' } },
      {
        environmentVariables: { CHILD_API_KEY: CHILD_SECRET },
        resolvedSecretTraceRegistry: registry,
      }
    )

    const projected = projectToolResultForCopilot(result as ToolExecutionResult, registry)
    expect(projected.output).toEqual({ success: true, result: { note: 'no secret here' } })
  })

  it('cannot redact a child-resolved value below the substitutable literal length', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'SHORT_KEY', plaintext: SHORT_SECRET, encryptedValue: SHORT_SECRET_ENCRYPTED }],
      SCOPE
    )

    mockExecute.mockImplementation(async (ctx: ExecutionContext) => {
      const resolved = resolveChildEnvReference(ctx, '{{SHORT_KEY}}', ['child-block', 'apiKey'])
      return { success: true, result: { token: resolved } }
    })

    const result = await runWorkflowTool(
      { workflowId: 'wf-child', _context: { workspaceId: 'ws-1', userId: 'user-1' } },
      { environmentVariables: { SHORT_KEY: SHORT_SECRET }, resolvedSecretTraceRegistry: registry }
    )

    const projected = projectToolResultForCopilot(result as ToolExecutionResult, registry)
    expect(JSON.stringify(projected)).toContain(SHORT_SECRET)
  })
})
