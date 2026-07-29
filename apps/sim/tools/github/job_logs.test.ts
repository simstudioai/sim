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

/** A storage host that honoured the suffix range: 206 plus the full size. */
function partialLogResponse(body: string, totalBytes: number): Response {
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': 'text/plain',
      'Content-Range': `bytes ${totalBytes - Buffer.byteLength(body)}-${totalBytes - 1}/${totalBytes}`,
    },
  })
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
      output: { logs: 'boom\n', truncated: false, totalBytes: 5 },
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
    expect(result.output).toMatchObject({ totalBytes: log.length, truncated: true })
  })

  // A verbose CI job exceeds the executor's 10 MB response cap, which throws rather
  // than truncating — so asking for only the tail is what keeps a diagnostic available
  // on exactly the runs that most need one.
  it('asks the storage host for only the tail it intends to keep', () => {
    const headers = jobLogsTool.request.headers({ ...BASE_PARAMS, maxCharacters: 4_096 })

    expect(headers.Range).toBe('bytes=-4096')
  })

  it('trims the partial first line of a ranged response and reports the full size', async () => {
    const result = await jobLogsTool.transformResponse!(
      partialLogResponse('ise\nFAILED: expected 1 to be 2', 10_000),
      { ...BASE_PARAMS, maxCharacters: 4_096 }
    )

    expect(result.output).toEqual({
      logs: 'FAILED: expected 1 to be 2',
      truncated: true,
      totalBytes: 10_000,
    })
  })

  // A host that ignores the range answers 200 with the whole body, so the local
  // slice has to remain the fallback rather than an assumption about partiality.
  it('falls back to the local slice when the range is ignored', async () => {
    const log = `${'noise\n'.repeat(100)}tail`

    const result = await jobLogsTool.transformResponse!(logResponse(log), {
      ...BASE_PARAMS,
      maxCharacters: 10,
    })

    expect(result.output.logs).toBe(log.slice(-10))
    expect(result.output).toMatchObject({ truncated: true, totalBytes: log.length })
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
