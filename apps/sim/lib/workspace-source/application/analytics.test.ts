import {
  createDelegatedPrincipal,
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { recordWorkspaceSourceApplied } from '@/lib/workspace-source/application/analytics'

const capture = posthogServerMockFns.mockCaptureServerEvent
const facts = {
  principal: createPersonalApiKeyPrincipal({ userId: 'user-1' }),
  client: 'cli',
  workspaceId: 'ws-1',
}

const planned = [
  { kind: 'table', action: 'create' },
  { kind: 'table', action: 'noop' },
  { kind: 'skill', action: 'noop' },
  { kind: 'workflow', action: 'update' },
  { kind: 'workflow', action: 'adopt' },
  { kind: 'secret', action: 'delete' },
] as const

describe('recordWorkspaceSourceApplied', () => {
  beforeEach(() => capture.mockClear())

  it('records a committed apply with the kinds it changed and its writes by action', () => {
    recordWorkspaceSourceApplied(facts, planned, {
      applied: planned.filter((c) => c.action !== 'noop'),
    })

    expect(capture).toHaveBeenCalledWith(
      'user-1',
      'workspace_source_applied',
      {
        workspace_id: 'ws-1',
        source: 'cli',
        outcome: 'committed',
        kinds: ['table', 'workflow', 'secret'],
        created: 1,
        updated: 2,
        deleted: 1,
      },
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('records an apply that stopped at a failed write as partial, with the failure code', () => {
    recordWorkspaceSourceApplied(facts, planned, {
      applied: [planned[0]],
      failed: { code: 'E_APPLY_STALE' },
    })

    expect(capture).toHaveBeenCalledWith(
      'user-1',
      'workspace_source_applied',
      expect.objectContaining({
        outcome: 'partial',
        created: 1,
        updated: 0,
        deleted: 0,
        error_kind: 'E_APPLY_STALE',
      }),
      { groups: { workspace: 'ws-1' } }
    )
  })

  it.each(['rejected', 'busy'] as const)('records a %s refusal with nothing written', (kind) => {
    recordWorkspaceSourceApplied(facts, planned, { refused: kind })

    expect(capture).toHaveBeenCalledWith(
      'user-1',
      'workspace_source_applied',
      expect.objectContaining({
        outcome: 'refused',
        kinds: ['table', 'workflow', 'secret'],
        created: 0,
        updated: 0,
        deleted: 0,
        error_kind: kind,
      }),
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('attributes a Copilot apply to its subject and records nothing for a workspace key', () => {
    recordWorkspaceSourceApplied(
      {
        ...facts,
        client: undefined,
        principal: createDelegatedPrincipal({ subjectUserId: 'user-9', workspaceId: 'ws-1' }),
      },
      planned,
      { applied: [] }
    )
    recordWorkspaceSourceApplied(
      { ...facts, principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'ws-1' }) },
      planned,
      { applied: [] }
    )

    expect(capture.mock.calls.map(([userId, , properties]) => [userId, properties.source])).toEqual(
      [['user-9', 'copilot']]
    )
  })
})
