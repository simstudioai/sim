/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveReviewThreadTool } from '@/tools/github/resolve_review_thread'
import type { ResolveReviewThreadParams } from '@/tools/github/types'

const BASE_PARAMS: ResolveReviewThreadParams = { threadId: 'PRRT_1', apiKey: 'ghp_test' }

describe('github_resolve_review_thread', () => {
  it('resolves by thread id', () => {
    const body = resolveReviewThreadTool.request.body!(BASE_PARAMS) as {
      query: string
      variables: Record<string, unknown>
    }

    expect(body.query).toContain('resolveReviewThread(input: { threadId: $threadId })')
    expect(body.variables).toEqual({ threadId: 'PRRT_1' })
  })

  it('returns the thread state GitHub reports back', async () => {
    const response = Response.json({
      data: { resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: true } } },
    })

    const result = await resolveReviewThreadTool.transformResponse!(response, BASE_PARAMS)

    expect(result).toEqual({ success: true, output: { id: 'PRRT_1', isResolved: true } })
  })

  it('fails on a GraphQL error payload delivered with HTTP 200', async () => {
    const response = Response.json({
      data: { resolveReviewThread: null },
      errors: [{ message: 'Must have write access to resolve' }],
    })

    await expect(resolveReviewThreadTool.transformResponse!(response, BASE_PARAMS)).rejects.toThrow(
      /Must have write access to resolve/
    )
  })
})
