/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({ mockExecuteTool: vi.fn() }))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import {
  fetchOpenPrSnapshot,
  fetchPrSnapshot,
  validateRepositoryCoordinates,
} from '@/executor/handlers/pi/github-pr'

const HEAD_SHA = 'a'.repeat(40)
const BASE_SHA = 'b'.repeat(40)

const COORDINATES = {
  owner: 'octo',
  repo: 'demo',
  pullNumber: 7,
  githubToken: 'ghp_secret',
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Add feature',
    body: 'Does the thing',
    html_url: 'https://github.com/octo/demo/pull/7',
    state: 'open',
    merged: false,
    mergeable: true,
    head: { sha: HEAD_SHA, ref: 'feature', repo_full_name: 'octo/demo' },
    base: { sha: BASE_SHA, ref: 'staging', repo_full_name: 'octo/demo' },
    ...overrides,
  }
}

describe('fetchPrSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({ success: true, output: snapshot() })
  })

  it('reads the pull request without its files, using the caller-supplied token', async () => {
    const result = await fetchPrSnapshot(COORDINATES)

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'github_pr_v2',
      {
        owner: 'octo',
        repo: 'demo',
        pullNumber: 7,
        includeFiles: false,
        apiKey: 'ghp_secret',
      },
      { signal: undefined }
    )
    expect(result).toMatchObject({ headSha: HEAD_SHA, baseSha: BASE_SHA, state: 'open' })
  })

  it('returns a closed or merged pull request instead of throwing', async () => {
    // This is the whole reason the state guard lives in the wrapper: a mode that
    // must report "the PR closed mid-run" as a result rather than as a failure
    // builds on this form, so folding the guard back in here would break it.
    mockExecuteTool.mockResolvedValue({ success: true, output: snapshot({ state: 'closed' }) })

    await expect(fetchPrSnapshot(COORDINATES)).resolves.toMatchObject({ state: 'closed' })
  })

  it('surfaces a failed read rather than returning an empty snapshot', async () => {
    mockExecuteTool.mockResolvedValue({ success: false, error: 'Not Found' })

    await expect(fetchPrSnapshot(COORDINATES)).rejects.toThrow('Failed to fetch PR #7: Not Found')
  })

  it('rejects a head SHA that is not a full commit id', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: snapshot({ head: { sha: 'abc' } }) })

    await expect(fetchPrSnapshot(COORDINATES)).rejects.toThrow(
      /head\.sha must be a full commit SHA/
    )
  })
})

describe('fetchOpenPrSnapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes an open pull request through', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: snapshot() })

    await expect(fetchOpenPrSnapshot(COORDINATES)).resolves.toMatchObject({ state: 'open' })
  })

  it('refuses anything that is not open', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: snapshot({ state: 'closed' }) })

    await expect(fetchOpenPrSnapshot(COORDINATES)).rejects.toThrow(
      'PR #7 is closed; only open PRs can be reviewed'
    )
  })
})

describe('validateRepositoryCoordinates', () => {
  it('accepts ordinary GitHub coordinates', () => {
    expect(() => validateRepositoryCoordinates(COORDINATES)).not.toThrow()
  })

  it.each([
    ['a traversal in the owner', { owner: '../octo' }],
    ['a traversal in the repo', { repo: '..' }],
    ['a slash in the repo', { repo: 'demo/evil' }],
    ['a non-positive pull number', { pullNumber: 0 }],
    ['a fractional pull number', { pullNumber: 1.5 }],
  ])('rejects %s before any credential is used', (_label, overrides) => {
    expect(() => validateRepositoryCoordinates({ ...COORDINATES, ...overrides })).toThrow(
      /Invalid GitHub repository coordinates/
    )
  })
})
