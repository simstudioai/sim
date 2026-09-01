import {
  bindPrincipalExecutionMetadata,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'

function bindPrincipal(principal: WorkflowExecutionPrincipal) {
  return bindPrincipalExecutionMetadata(principal, {
    executionId: 'execution-1',
    rootWorkflowId: 'workflow-1',
    currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
  })
}

const metadata: ExecutionMetadata = {
  requestId: 'request-1',
  executionId: 'execution-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  principal: bindPrincipal({ kind: 'session', userId: 'user-1', sessionId: 'session-1' }),
  triggerType: 'manual',
  useDraftState: true,
  startTime: '2026-05-06T00:00:00.000Z',
}

describe('ExecutionSnapshot', () => {
  it('normalizes untyped state and persists a strict versioned runtime principal', () => {
    const variable = { id: 'var-1', name: 'brand', type: 'plain', value: 'myfitness' }

    const snapshot = new ExecutionSnapshot(
      metadata,
      { blocks: [] },
      {},
      [variable],
      ['agent.content', 123, 'function.result']
    )

    expect(snapshot.toJSON()).toMatch(/^\{"metadata":/)
    expect(JSON.parse(snapshot.toJSON())).toMatchObject({
      version: 2,
      metadata: {
        principal: {
          version: 2,
          executionMetadata: metadata.principal.executionMetadata,
        },
      },
    })
    expect(snapshot.workflowVariables).toEqual({ 'var-1': variable })
    expect(snapshot.selectedOutputs).toEqual(['agent.content', 'function.result'])
  })

  it.each([
    {
      name: 'manual user',
      principal: { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' },
    },
    {
      name: 'personal API key',
      principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
    },
    {
      name: 'workspace API key',
      principal: {
        kind: 'workspace_api_key' as const,
        workspaceId: 'workspace-1',
        keyId: 'key-1',
      },
    },
    {
      name: 'schedule',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
    },
    {
      name: 'Slack webhook',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user' as const,
          provider: 'slack',
          tenantId: 'T123',
          subjectId: 'U123',
        },
      },
    },
  ])('round trips the $name actor and execution authority', ({ principal }) => {
    const runtimePrincipal = bindPrincipal(principal)
    const snapshot = new ExecutionSnapshot(
      { ...metadata, principal: runtimePrincipal },
      { blocks: [] },
      {},
      {},
      []
    )

    const restored = ExecutionSnapshot.fromJSON(snapshot.toJSON())

    expect(restored.metadata.principal).toEqual(runtimePrincipal)
  })

  it('round trips delegated-principal dates without changing the actor', () => {
    const principal = bindPrincipal({
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-05-06T00:00:00.000Z'),
      expiresAt: new Date('2026-05-06T00:05:00.000Z'),
    })
    const snapshot = new ExecutionSnapshot({ ...metadata, principal }, { blocks: [] }, {}, {}, [])

    const restored = ExecutionSnapshot.fromJSON(snapshot.toJSON())

    expect(restored.metadata.principal).toEqual(principal)
    expect(
      restored.metadata.principal.kind === 'delegated' && restored.metadata.principal.issuedAt
    ).toBeInstanceOf(Date)
  })

  it('rejects malformed persisted execution metadata', () => {
    const serialized = JSON.parse(new ExecutionSnapshot(metadata, {}, {}, {}, []).toJSON())
    serialized.metadata.principal.executionMetadata.currentWorkflow.workflowId = ''

    expect(() => ExecutionSnapshot.fromJSON(JSON.stringify(serialized))).toThrow(
      'currentWorkflow.workflowId must be a non-empty string'
    )
  })

  it('rejects persisted snapshots without a principal', () => {
    const { principal: _principal, ...metadataWithoutPrincipal } = metadata

    expect(() =>
      ExecutionSnapshot.fromJSON(
        JSON.stringify({
          version: 2,
          metadata: metadataWithoutPrincipal,
          workflow: { blocks: [] },
          input: {},
          workflowVariables: {},
          selectedOutputs: [],
        })
      )
    ).toThrow('Execution snapshot metadata is missing its principal')
  })

  it('rejects versioned snapshots whose principal has no execution metadata', () => {
    expect(() =>
      ExecutionSnapshot.fromJSON(
        JSON.stringify({
          version: 2,
          metadata: {
            ...metadata,
            principal: {
              version: 1,
              principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            },
          },
          workflow: { blocks: [] },
          input: {},
          workflowVariables: {},
          selectedOutputs: [],
        })
      )
    ).toThrow('missing execution metadata')
  })

  it.each([undefined, 1, 3])('rejects unsupported execution snapshot version %s', (version) => {
    expect(() =>
      ExecutionSnapshot.fromJSON(
        JSON.stringify({
          ...(version === undefined ? {} : { version }),
          metadata,
          workflow: { blocks: [] },
          input: {},
          workflowVariables: {},
          selectedOutputs: [],
        })
      )
    ).toThrow(`Unsupported execution snapshot version ${String(version)}`)
  })
})
