/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ compileLatexDocument: vi.fn() }))

vi.mock('@/lib/internal/latex/operations', () => ({
  compileLatexDocument: mocks.compileLatexDocument,
}))

import { executeLatexTool } from '@/lib/internal/latex/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executeLatexTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.compileLatexDocument.mockResolvedValue({ pdfUrl: '/file.pdf' })
  })

  it('uses trusted execution context instead of tool parameters', async () => {
    const controller = new AbortController()
    const input = { content: '\\documentclass{article}\\begin{document}x\\end{document}' }
    const request: InternalToolOperationCall = {
      toolId: 'latex_compile',
      input,
      headers: new Headers(),
      context: {
        ...createExecutionContext({ workflowId: 'workflow-1', executionId: 'execution-1' }),
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect((await executeLatexTool(request)).status).toBe(200)
    expect(mocks.compileLatexDocument).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      signal: controller.signal,
    })
  })
})
