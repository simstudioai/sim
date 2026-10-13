import { describe, expect, it } from 'vitest'
import {
  isSocketWorkflowVisible,
  releaseWorkflowRequest,
  type WorkflowRequest,
} from '@/app/workspace/providers/socket-join-target'

const request = (token: string, workflowId: string): WorkflowRequest => ({ token, workflowId })

describe('socket join target helpers', () => {
  it('rejects mismatched workflow visibility', () => {
    expect(
      isSocketWorkflowVisible({
        workflowId: 'workflow-other',
        requestedWorkflowId: 'workflow-requested',
      })
    ).toBe(false)
  })

  it('accepts the requested workflow as visible', () => {
    expect(
      isSocketWorkflowVisible({ workflowId: 'workflow-a', requestedWorkflowId: 'workflow-a' })
    ).toBe(true)
  })

  it('treats no requested room as nothing visible', () => {
    expect(isSocketWorkflowVisible({ workflowId: null, requestedWorkflowId: null })).toBe(false)
  })

  it('keeps an earlier editor requested when a later one unmounts', () => {
    expect(
      releaseWorkflowRequest([request('t1', 'workflow-a'), request('t2', 'workflow-b')], 't2')
    ).toEqual([request('t1', 'workflow-a')])
  })

  it('removes an earlier editor without disturbing the one mounted above it', () => {
    expect(
      releaseWorkflowRequest([request('t1', 'workflow-a'), request('t2', 'workflow-b')], 't1')
    ).toEqual([request('t2', 'workflow-b')])
  })

  it('keeps the newer mount of a workflow on top when the older mount of it unmounts', () => {
    expect(
      releaseWorkflowRequest(
        [request('t1', 'workflow-a'), request('t2', 'workflow-b'), request('t3', 'workflow-a')],
        't1'
      )
    ).toEqual([request('t2', 'workflow-b'), request('t3', 'workflow-a')])
  })

  it('ignores a release for a mount that never joined', () => {
    const requests = [request('t1', 'workflow-a')]
    expect(releaseWorkflowRequest(requests, 't9')).toBe(requests)
  })
})
