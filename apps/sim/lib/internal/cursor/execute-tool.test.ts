/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ downloadCursorArtifact: vi.fn() }))

vi.mock('@/lib/internal/cursor/operations', () => ({
  downloadCursorArtifact: mocks.downloadCursorArtifact,
  cursorOperationErrorMessage: (error: unknown) =>
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : 'Unknown error occurred',
}))

import { CursorOperationError } from '@/lib/internal/cursor/errors'
import { executeCursorTool } from '@/lib/internal/cursor/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'cursor_download_artifact',
    input: { apiKey: 'cursor-key', agentId: 'agent-1', path: '/src/index.ts' },
    headers: new Headers(),
    context: createExecutionContext({ workflowId: 'workflow-1' }),
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeCursorTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadCursorArtifact.mockResolvedValue({
      success: true,
      output: { file: { name: 'index.ts', mimeType: 'text/plain', data: 'YQ==', size: 1 } },
    })
  })

  it.each(['cursor_download_artifact', 'cursor_download_artifact_v2'])(
    'dispatches %s without an HTTP route',
    async (toolId) => {
      const controller = new AbortController()
      const response = await executeCursorTool(request({ toolId, signal: controller.signal }))

      expect(response.status).toBe(200)
      expect(mocks.downloadCursorArtifact).toHaveBeenCalledWith(
        { apiKey: 'cursor-key', agentId: 'agent-1', path: '/src/index.ts' },
        { requestId: 'request-1', signal: controller.signal }
      )
    }
  )

  it('rejects invalid input before provider work', async () => {
    const response = await executeCursorTool(request({ input: { apiKey: '' } }))

    expect(response.status).toBe(400)
    expect(mocks.downloadCursorArtifact).not.toHaveBeenCalled()
  })

  it('preserves provider status errors', async () => {
    mocks.downloadCursorArtifact.mockRejectedValue(new CursorOperationError('not found', 404))

    const response = await executeCursorTool(request())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'not found' })
  })
})
