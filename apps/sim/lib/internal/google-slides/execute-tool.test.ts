import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exportGoogleSlidesPresentation: vi.fn() }))

vi.mock('@/lib/internal/google-slides/operations', () => ({
  exportGoogleSlidesPresentation: mocks.exportGoogleSlidesPresentation,
}))

import { executeGoogleSlidesTool } from '@/lib/internal/google-slides/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'google_slides_export_presentation',
    input: { accessToken: 'token', presentationId: 'presentation-1' },
    headers: new Headers(),
    context: {
      ...createExecutionContext({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      }),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeGoogleSlidesTool', () => {
  beforeEach(() => {
    mocks.exportGoogleSlidesPresentation.mockResolvedValue({ success: true, output: {} })
  })

  it('rejects invalid presentation IDs before provider work', async () => {
    const response = await executeGoogleSlidesTool(
      request({ input: { accessToken: 'token', presentationId: '../presentation' } })
    )

    expect(response.status).toBe(400)
    expect(mocks.exportGoogleSlidesPresentation).not.toHaveBeenCalled()
  })
})
