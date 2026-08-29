/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { checkStarTool, checkStarV2Tool } from '@/tools/github/check_star'

const PARAMS = { owner: 'octocat', repo: 'hello-world', apiKey: 'token' }

function statusOnly(status: number): Response {
  return new Response(null, { status })
}

describe('github_check_star', () => {
  /**
   * GitHub documents 204 for "starred" and 404 for "not starred" on
   * `GET /user/starred/{owner}/{repo}`, both with no body. The executor rejects
   * every non-2xx before `transformResponse` runs unless the tool declares the
   * status, so without this the negative answer is unreachable.
   */
  it('declares the documented 404 so the negative answer reaches transformResponse', () => {
    expect(checkStarTool.nonErrorStatuses).toContain(404)
  })

  it('reports a starred repository on 204', async () => {
    const result = await checkStarTool.transformResponse!(statusOnly(204), PARAMS as never)

    expect(result.success).toBe(true)
    expect(result.output.metadata.starred).toBe(true)
  })

  it('reports an unstarred repository on 404 rather than failing', async () => {
    const result = await checkStarTool.transformResponse!(statusOnly(404), PARAMS as never)

    expect(result.success).toBe(true)
    expect(result.output.metadata.starred).toBe(false)
    expect(result.output.content).toContain('have not starred')
  })

  it('carries the same tolerance on the v2 tool', async () => {
    expect(checkStarV2Tool.nonErrorStatuses).toContain(404)

    const result = await checkStarV2Tool.transformResponse!(statusOnly(404), PARAMS as never)

    expect(result.success).toBe(true)
    expect(result.output.starred).toBe(false)
  })
})
