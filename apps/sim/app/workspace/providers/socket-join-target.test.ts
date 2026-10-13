import { describe, expect, it } from 'vitest'
import {
  isSocketWorkflowVisible,
  releaseWorkflowRequest,
} from '@/app/workspace/providers/socket-join-target'

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
    expect(releaseWorkflowRequest(['workflow-a', 'workflow-b'], 'workflow-b')).toEqual([
      'workflow-a',
    ])
  })

  it('removes an earlier editor without disturbing the one mounted above it', () => {
    expect(releaseWorkflowRequest(['workflow-a', 'workflow-b'], 'workflow-a')).toEqual([
      'workflow-b',
    ])
  })

  it('releases only one request when the same workflow is mounted twice', () => {
    expect(releaseWorkflowRequest(['workflow-a', 'workflow-a'], 'workflow-a')).toEqual([
      'workflow-a',
    ])
  })

  it('ignores a release for a workflow that never joined', () => {
    const requests = ['workflow-a']
    expect(releaseWorkflowRequest(requests, 'workflow-b')).toBe(requests)
  })
})
