/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeGitHubCommentOperation: vi.fn(),
  executeGitHubCommentV2Operation: vi.fn(),
  getGitHubLatestCommit: vi.fn(),
}))

vi.mock('@/lib/internal/github/operations', () => ({
  executeGitHubCommentOperation: mocks.executeGitHubCommentOperation,
  executeGitHubCommentV2Operation: mocks.executeGitHubCommentV2Operation,
  getGitHubLatestCommit: mocks.getGitHubLatestCommit,
}))

import { executeGitHubTool } from '@/lib/internal/github/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executeGitHubTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeGitHubCommentOperation.mockResolvedValue({ success: true, output: {} })
    mocks.executeGitHubCommentV2Operation.mockResolvedValue({ success: true, output: {} })
    mocks.getGitHubLatestCommit.mockResolvedValue({ success: true, output: {} })
  })

  it.each([
    ['github_comment', mocks.executeGitHubCommentOperation],
    ['github_comment_v2', mocks.executeGitHubCommentV2Operation],
  ])('dispatches %s to its typed operation', async (toolId, operation) => {
    const controller = new AbortController()
    const input = {
      owner: 'simstudioai',
      repo: 'sim',
      pullNumber: 7,
      body: 'Looks good',
      apiKey: 'token',
    }
    const request: InternalToolOperationCall = {
      toolId,
      input,
      headers: new Headers(),
      context: createExecutionContext(),
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect((await executeGitHubTool(request)).status).toBe(200)
    expect(operation).toHaveBeenCalledWith(input, controller.signal, request.context)
  })

  it.each(['github_latest_commit', 'github_latest_commit_v2'])(
    'dispatches %s to the same typed operation',
    async (toolId) => {
      const controller = new AbortController()
      const input = { owner: 'simstudioai', repo: 'sim', branch: 'staging', apiKey: 'token' }
      const request: InternalToolOperationCall = {
        toolId,
        input,
        headers: new Headers(),
        context: createExecutionContext(),
        requestId: 'request-1',
        signal: controller.signal,
      }

      expect((await executeGitHubTool(request)).status).toBe(200)
      expect(mocks.getGitHubLatestCommit).toHaveBeenCalledWith(input, {
        requestId: 'request-1',
        signal: controller.signal,
      })
    }
  )
})
