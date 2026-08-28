import { describe, expect, it } from 'vitest'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'

const metadata: ExecutionMetadata = {
  requestId: 'request-1',
  executionId: 'execution-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  triggerType: 'manual',
  startTime: '2026-05-06T00:00:00.000Z',
}

describe('ExecutionSnapshot', () => {
  it('normalizes untyped persisted execution state at construction', () => {
    const variable = { id: 'var-1', name: 'brand', type: 'plain', value: 'myfitness' }

    const snapshot = new ExecutionSnapshot(
      metadata,
      { blocks: [] },
      {},
      [variable],
      ['agent.content', 123, 'function.result']
    )

    expect(snapshot.toJSON()).toMatch(/^\{"metadata":/)
    expect(JSON.parse(snapshot.toJSON())).toMatchObject({ version: 1 })
    expect(snapshot.workflowVariables).toEqual({ 'var-1': variable })
    expect(snapshot.selectedOutputs).toEqual(['agent.content', 'function.result'])
  })

  it('round trips a delegated principal through persisted JSON', () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-05-06T00:00:00.000Z'),
      expiresAt: new Date('2026-05-06T00:05:00.000Z'),
    }
    const snapshot = new ExecutionSnapshot({ ...metadata, principal }, { blocks: [] }, {}, {}, [])

    const restored = ExecutionSnapshot.fromJSON(snapshot.toJSON())

    expect(restored.metadata.principal).toEqual(principal)
    expect(
      restored.metadata.principal?.kind === 'delegated' && restored.metadata.principal.issuedAt
    ).toBeInstanceOf(Date)
  })

  it('rejects malformed persisted principals', () => {
    expect(() =>
      ExecutionSnapshot.fromJSON(
        JSON.stringify({
          version: 1,
          metadata: { ...metadata, principal: { version: 99, principal: {} } },
          workflow: { blocks: [] },
          input: {},
          workflowVariables: {},
          selectedOutputs: [],
        })
      )
    ).toThrow('Unsupported serialized principal version')
  })

  it('rejects persisted snapshots without a principal', () => {
    const { principal: _principal, ...metadataWithoutPrincipal } = metadata

    expect(() =>
      ExecutionSnapshot.fromJSON(
        JSON.stringify({
          version: 1,
          metadata: metadataWithoutPrincipal,
          workflow: { blocks: [] },
          input: {},
          workflowVariables: {},
          selectedOutputs: [],
        })
      )
    ).toThrow('Execution snapshot metadata is missing its principal')
  })

  it('restores the recorded session user from a legacy pause snapshot', () => {
    const { principal: _principal, ...legacyMetadata } = metadata
    const restored = ExecutionSnapshot.fromJSON(
      JSON.stringify({
        metadata: { ...legacyMetadata, sessionUserId: 'session-user-1' },
        workflow: { blocks: [] },
        input: {},
        workflowVariables: {},
        selectedOutputs: [],
      })
    )

    expect(restored.metadata.principal).toEqual({
      kind: 'session',
      userId: 'session-user-1',
      sessionId: 'legacy-paused-execution',
    })
  })

  it('restores the recorded API-key actor from a legacy pause snapshot', () => {
    const { principal: _principal, ...legacyMetadata } = metadata
    const restored = ExecutionSnapshot.fromJSON(
      JSON.stringify({
        metadata: { ...legacyMetadata, enforceCredentialAccess: true },
        workflow: { blocks: [] },
        input: {},
        workflowVariables: {},
        selectedOutputs: [],
      })
    )

    expect(restored.metadata.principal).toEqual({
      kind: 'session',
      userId: 'user-1',
      sessionId: 'legacy-paused-execution',
    })
  })

  it('restores actorless legacy pause snapshots as internal system executions', () => {
    const { principal: _principal, ...legacyMetadata } = metadata
    const restored = ExecutionSnapshot.fromJSON(
      JSON.stringify({
        metadata: legacyMetadata,
        workflow: { blocks: [] },
        input: {},
        workflowVariables: {},
        selectedOutputs: [],
      })
    )

    expect(restored.metadata.principal).toEqual({
      kind: 'system',
      serviceId: 'internal',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
  })

  it('rejects unsupported execution snapshot versions', () => {
    expect(() =>
      ExecutionSnapshot.fromJSON(
        JSON.stringify({
          version: 2,
          metadata,
          workflow: { blocks: [] },
          input: {},
          workflowVariables: {},
          selectedOutputs: [],
        })
      )
    ).toThrow('Unsupported execution snapshot version 2')
  })
})
