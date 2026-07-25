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

  it('decodes multi-byte characters split across stream chunks', async () => {
    // '✓' is three bytes; splitting it across two chunks would yield U+FFFD if the
    // decoder were not run in streaming mode.
    const encoded = new TextEncoder().encode('ok ✓ done')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 4))
        controller.enqueue(encoded.slice(4))
        controller.close()
      },
    })

    const result = await jobLogsTool.transformResponse!(new Response(stream), BASE_PARAMS)

    expect(result.output.logs).toBe('ok ✓ done')
  })
})
