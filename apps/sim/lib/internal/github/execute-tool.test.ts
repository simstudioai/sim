/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getGitHubLatestCommit: vi.fn() }))

vi.mock('@/lib/internal/github/operations', () => ({
  getGitHubLatestCommit: mocks.getGitHubLatestCommit,
}))

import { executeGitHubTool } from '@/lib/internal/github/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executeGitHubTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getGitHubLatestCommit.mockResolvedValue({ success: true, output: {} })
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
