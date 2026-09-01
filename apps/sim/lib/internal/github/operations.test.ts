/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { getGitHubLatestCommit } from '@/lib/internal/github/operations'

describe('getGitHubLatestCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.secureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({
          sha: 'abc123',
          html_url: 'https://github.com/simstudioai/sim/commit/abc123',
          commit: {
            message: 'ship it',
            author: { name: 'Author', email: 'author@example.com', date: '2026-08-27' },
            committer: { name: 'Committer', email: 'committer@example.com', date: '2026-08-27' },
          },
          files: [
            {
              filename: 'README.md',
              status: 'modified',
              additions: 1,
              deletions: 0,
              changes: 1,
              raw_url: 'https://raw.githubusercontent.com/simstudioai/sim/abc123/README.md',
            },
          ],
        })
      )
      .mockResolvedValueOnce(new Response('updated readme'))
  })

  it('pins provider requests, forwards cancellation, and includes changed file content', async () => {
    const controller = new AbortController()
    const result = await getGitHubLatestCommit(
      { owner: 'simstudioai', repo: 'sim', branch: 'feature/test', apiKey: 'token' },
      { requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
    expect(mocks.secureFetchWithPinnedIP.mock.calls[0][0]).toContain('/commits/feature%2Ftest')
    expect(mocks.secureFetchWithPinnedIP.mock.calls[0][2]).toEqual(
      expect.objectContaining({ signal: controller.signal })
    )
    expect(result.output.metadata.files?.[0]).toEqual(
      expect.objectContaining({ filename: 'README.md', content: 'updated readme' })
    )
  })
})
