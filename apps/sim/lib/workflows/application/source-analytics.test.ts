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
  recordSourceRefused,
  recordSourceWritten,
} from '@/lib/workflows/application/source-analytics'
import {
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import { emptyDiffSummary } from '@/lib/workflows/application/source-locate'

const capture = posthogServerMockFns.mockCaptureServerEvent
const personal = createPersonalApiKeyPrincipal({ userId: 'user-1' })
const facts = {
  principal: personal,
  client: 'cli',
  operation: 'apply' as const,
  workspaceId: 'ws-1',
}

describe('recordSourceRefused', () => {
  beforeEach(() => capture.mockClear())

  it.each([
    ['stale', new WorkflowSourceStaleError('sf1:x')],
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
      new WorkflowSourceStaleError('sf1:x')
    )

    expect(capture).not.toHaveBeenCalled()
  })
})

describe('recordSourceWritten', () => {
  beforeEach(() => capture.mockClear())

  it('counts a create from source as a workflow creation, attributed to the Copilot subject', () => {
    const diff = emptyDiffSummary()
    diff.blocks.added.push({ id: 'b-1', key: 'start' })

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
