import {
  createDelegatedPrincipal,
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  recordSourceDryRun,
  recordSourceRead,
  recordSourceRefused,
  recordSourceWritten,
} from '@/lib/workflows/application/source-analytics'
import { emptyDiffSummary } from '@/lib/workflows/application/source-diff'
import {
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'

const capture = posthogServerMockFns.mockCaptureServerEvent
const personal = createPersonalApiKeyPrincipal({ userId: 'user-1' })
const facts = {
  principal: personal,
  client: 'cli',
  operation: 'apply' as const,
  workspaceId: 'ws-1',
  dryRun: false,
}

describe('recordSourceRefused', () => {
  beforeEach(() => capture.mockClear())

  it.each([
    ['stale', new WorkflowSourceStaleError('sf1:x', 'Lead Scoring')],
    ['rejected', new WorkflowSourceRejectedError([])],
    ['locked', new OrchestrationError('locked', 'Workflow is locked')],
  ])('records a %s refusal as ok:false with its error_kind', (kind, error) => {
    recordSourceRefused({ ...facts, workflowId: 'wf-1' }, error)

    expect(capture).toHaveBeenCalledWith(
      'user-1',
      'workflow_source_applied',
      {
        workflow_id: 'wf-1',
        workspace_id: 'ws-1',
        source: 'cli',
        operation: 'apply',
        ok: false,
        ops: 0,
        error_kind: kind,
      },
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('records nothing for a failure that is not an apply outcome', () => {
    recordSourceRefused(
      { ...facts, workflowId: 'wf-1' },
      new OrchestrationError('not_found', 'Workflow not found')
    )
    recordSourceRefused({ ...facts, workflowId: 'wf-1' }, new Error('boom'))

    expect(capture).not.toHaveBeenCalled()
  })

  it('records nothing for a caller with no user to attribute it to', () => {
    recordSourceRefused(
      {
        ...facts,
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'ws-1' }),
        workflowId: 'wf-1',
      },
      new WorkflowSourceStaleError('sf1:x', 'Lead Scoring')
    )

    expect(capture).not.toHaveBeenCalled()
  })
})

describe('recordSourceWritten', () => {
  beforeEach(() => capture.mockClear())

  it('counts a create from source as a workflow creation, attributed to the Copilot subject', () => {
    const diff = emptyDiffSummary()
    diff.blocks.added.push({ id: 'b-1', key: 'start', type: 'start_trigger' })

    recordSourceWritten(
      {
        ...facts,
        principal: createDelegatedPrincipal({ subjectUserId: 'user-9', workspaceId: 'ws-1' }),
        operation: 'create',
      },
      { workflowId: 'wf-2', workflowName: 'Triage', diff }
    )

    expect(capture).toHaveBeenCalledWith(
      'user-9',
      'workflow_source_applied',
      expect.objectContaining({ operation: 'create', ok: true, ops: 1, source: 'copilot' }),
      { groups: { workspace: 'ws-1' } }
    )
    expect(capture).toHaveBeenCalledWith(
      'user-9',
      'workflow_created',
      { workflow_id: 'wf-2', workspace_id: 'ws-1', name: 'Triage', source: 'copilot' },
      expect.objectContaining({ groups: { workspace: 'ws-1' } })
    )
  })

  it('records no workflow_created for an apply to an existing workflow', () => {
    recordSourceWritten(facts, { workflowId: 'wf-1', workflowName: 'W', diff: emptyDiffSummary() })

    expect(capture.mock.calls.map(([, event]) => event)).toEqual(['workflow_source_applied'])
  })
})

describe('recordSourceDryRun', () => {
  beforeEach(() => capture.mockClear())

  const error = (code: string) => ({ code, severity: 'error' as const })

  it('records a clean dry run as ok with the changes a commit would make', () => {
    const diff = emptyDiffSummary()
    diff.blocks.added.push({ id: 'b-1', key: 'start', type: 'start_trigger' })
    diff.edges.added = 2

    recordSourceDryRun(
      { ...facts, dryRun: true, workflowId: 'wf-1' },
      { diff, diagnostics: [{ code: 'W_UNUSED', severity: 'warning' }] }
    )

    expect(capture).toHaveBeenCalledWith(
      'user-1',
      'workflow_source_dry_run',
      {
        workflow_id: 'wf-1',
        workspace_id: 'ws-1',
        source: 'cli',
        operation: 'apply',
        ok: true,
        ops: 3,
      },
      { groups: { workspace: 'ws-1' } }
    )
  })

  it.each([
    ['stale', [error('E_APPLY_STALE')]],
    ['rejected', [error('E_UNKNOWN_BLOCK'), error('E_APPLY_STALE')]],
  ])('records a dry run with errors as ok:false, %s', (kind, diagnostics) => {
    recordSourceDryRun(
      { ...facts, dryRun: true, workflowId: 'wf-1' },
      { diff: emptyDiffSummary(), diagnostics }
    )

    expect(capture).toHaveBeenCalledWith(
      'user-1',
      'workflow_source_dry_run',
      expect.objectContaining({ ok: false, ops: 0, error_kind: kind }),
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('records a refused dry run as a dry run, never as an apply', () => {
    recordSourceRefused(
      { ...facts, dryRun: true, workflowId: 'wf-1' },
      new OrchestrationError('locked', 'Workflow is locked')
    )

    expect(capture.mock.calls.map(([, event, properties]) => [event, properties])).toEqual([
      [
        'workflow_source_dry_run',
        {
          workflow_id: 'wf-1',
          workspace_id: 'ws-1',
          source: 'cli',
          operation: 'apply',
          ok: false,
          ops: 0,
          error_kind: 'locked',
        },
      ],
    ])
  })
})

describe('recordSourceRead', () => {
  beforeEach(() => capture.mockClear())

  it('records a read by the user behind a key as an api read', () => {
    recordSourceRead(personal, { workflowId: 'wf-1', workspaceId: 'ws-1' })

    expect(capture).toHaveBeenCalledWith(
      'user-1',
      'workflow_source_read',
      { workflow_id: 'wf-1', workspace_id: 'ws-1', source: 'api' },
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('records a Copilot read against its subject and nothing for a workspace key', () => {
    recordSourceRead(createDelegatedPrincipal({ subjectUserId: 'user-9', workspaceId: 'ws-1' }), {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
    })
    recordSourceRead(createWorkspaceApiKeyPrincipal({ workspaceId: 'ws-1' }), {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
    })

    expect(capture.mock.calls).toEqual([
      [
        'user-9',
        'workflow_source_read',
        { workflow_id: 'wf-1', workspace_id: 'ws-1', source: 'copilot' },
        { groups: { workspace: 'ws-1' } },
      ],
    ])
  })
})
