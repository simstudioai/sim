import { describe, expect, it } from 'vitest'
import { getIssueTool } from '@/tools/sentry/issues_get'
import { listIssuesTool } from '@/tools/sentry/issues_list'
import { createReleaseTool } from '@/tools/sentry/releases_create'
import type { SentryCreateReleaseParams, SentryGetIssueParams } from '@/tools/sentry/types'

const AUTH = { apiKey: 'token', organizationSlug: 'acme' }

function releaseBody(overrides: Partial<SentryCreateReleaseParams>) {
  return createReleaseTool.request.body?.({
    ...AUTH,
    version: '1.0.0',
    projects: 'web',
    ...overrides,
  })
}

function issueUrl(params: SentryGetIssueParams) {
  const { url } = getIssueTool.request
  return typeof url === 'function' ? url(params) : url
}

describe('sentry_releases_create body', () => {
  it('sends commits that arrive as an array from a block reference', () => {
    const commits = [{ id: 'abc123', message: 'Fix bug' }]
    expect(releaseBody({ commits })).toMatchObject({ commits })
  })

  it('rejects malformed commits JSON instead of creating the release without commits', () => {
    expect(() => releaseBody({ commits: '[{"id":"abc123"},]' })).toThrow(/JSON array/)
  })

  it('rejects a commits value that is neither an array nor JSON text', () => {
    expect(() => releaseBody({ commits: JSON.parse('{"id":"abc123"}') })).toThrow(/JSON array/)
  })

  it('accepts projects that arrive as an array', () => {
    expect(releaseBody({ projects: ['web', ' api ', ''] })).toMatchObject({
      projects: ['web', 'api'],
    })
  })
})

describe('sentry path segments', () => {
  it('rejects an issue id that would rewrite the request path', () => {
    expect(() => issueUrl({ ...AUTH, issueId: '123/../../projects/acme/other' })).toThrow(/issueId/)
  })
})

describe('sentry list pagination', () => {
  it('exposes the next cursor at the top level, where the block output points', async () => {
    const response = new Response('[]', {
      headers: {
        Link: '<https://sentry.io/api/0/organizations/acme/issues/?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"',
      },
    })
    const result = await listIssuesTool.transformResponse?.(response)
    expect(result?.output).toMatchObject({ nextCursor: '0:100:0', hasMore: true })
  })
})
