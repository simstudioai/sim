/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { jobLogsTool } from '@/tools/github/job_logs'
import type { JobLogsParams } from '@/tools/github/types'

const BASE_PARAMS: JobLogsParams = {
  owner: 'octo',
  repo: 'demo',
  job_id: 42,
  apiKey: 'ghp_test',
}

function logResponse(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } })
}

describe('github_job_logs', () => {
  it('reads the per-job log endpoint, not the run-level archive', () => {
    const url = (jobLogsTool.request.url as (params: JobLogsParams) => string)(BASE_PARAMS)

    expect(url).toBe('https://api.github.com/repos/octo/demo/actions/jobs/42/logs')
  })

  it('escapes coordinates so they cannot redirect the authenticated request', () => {
    const url = (jobLogsTool.request.url as (params: JobLogsParams) => string)({
      ...BASE_PARAMS,
      owner: '../../orgs/secret',
      repo: 'demo?ref=x',
    })

    expect(url).toBe(
      'https://api.github.com/repos/..%2F..%2Forgs%2Fsecret/demo%3Fref%3Dx/actions/jobs/42/logs'
    )
  })

  it('rejects a job id that is not a positive integer', () => {
    const url = jobLogsTool.request.url as (params: JobLogsParams) => string

    expect(() => url({ ...BASE_PARAMS, job_id: 0 })).toThrow(/job_id must be a positive integer/)
    expect(() => url({ ...BASE_PARAMS, job_id: 1.5 })).toThrow(/job_id must be a positive integer/)
    expect(() => url({ ...BASE_PARAMS, job_id: '9/../..' as unknown as number })).toThrow(
      /job_id must be a positive integer/
    )
  })

  it('returns a short log whole', async () => {
    const result = await jobLogsTool.transformResponse!(logResponse('boom\n'), BASE_PARAMS)

    expect(result).toEqual({
      success: true,
      output: { logs: 'boom\n', totalCharacters: 5, truncated: false },
    })
  })

  it('keeps the tail of a long log, where the failure is reported', async () => {
    const log = `${'noise\n'.repeat(5_000)}FAILED: expected 1 to be 2`

    const result = await jobLogsTool.transformResponse!(logResponse(log), {
      ...BASE_PARAMS,
      maxCharacters: 40,
    })

    expect(result.output.logs).toHaveLength(40)
    expect(result.output.logs.endsWith('FAILED: expected 1 to be 2')).toBe(true)
    expect(result.output).toMatchObject({ totalCharacters: log.length, truncated: true })
  })

  it('rejects a cap outside the supported range', async () => {
    await expect(
      jobLogsTool.transformResponse!(logResponse('x'), { ...BASE_PARAMS, maxCharacters: 0 })
    ).rejects.toThrow(/maxCharacters must be an integer between 1 and 200000/)
  })

  it('drops the GitHub token on the redirect to third-party blob storage', () => {
    // The tool fetch follows redirects itself rather than through the fetch spec,
    // so without this the PAT would be replayed to the storage host.
    expect(jobLogsTool.request.stripAuthOnRedirect).toBe(true)
  })
})
