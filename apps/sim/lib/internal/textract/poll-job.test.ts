/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { describe, expect, it } from 'vitest'
import { pollTextractJob } from '@/lib/internal/textract/poll-job'

const logger = createLogger('TextractPollJobTest')

describe('pollTextractJob', () => {
  it('returns immediately on success without a next token', async () => {
    const result = await pollTextractJob(
      'request-1',
      logger,
      async () => ({ JobStatus: 'SUCCEEDED', Blocks: [{ Id: '1' }] }),
      (accumulated, page) => ({
        ...page,
        Blocks: [...(accumulated.Blocks ?? []), ...(page.Blocks ?? [])],
      })
    )

    expect(result.JobStatus).toBe('SUCCEEDED')
    expect(result.Blocks).toHaveLength(1)
  })

  it('follows pagination and merges pages', async () => {
    let calls = 0
    const result = await pollTextractJob(
      'request-2',
      logger,
      async (nextToken) => {
        calls += 1
        if (!nextToken) {
          return { JobStatus: 'SUCCEEDED', Blocks: [{ Id: '1' }], NextToken: 'next' }
        }
        return { JobStatus: 'SUCCEEDED', Blocks: [{ Id: '2' }] }
      },
      (accumulated, page) => ({
        ...accumulated,
        ...page,
        Blocks: [...(accumulated.Blocks ?? []), ...(page.Blocks ?? [])],
      })
    )

    expect(calls).toBe(2)
    expect(result.Blocks).toHaveLength(2)
  })

  it('preserves first-page metadata omitted from later pages', async () => {
    const result = await pollTextractJob<{
      JobStatus?: string
      NextToken?: string
      Blocks?: unknown[]
      DocumentMetadata?: { Pages?: number }
    }>(
      'request-3',
      logger,
      async (nextToken) => {
        if (!nextToken) {
          return {
            JobStatus: 'SUCCEEDED',
            Blocks: [{ Id: '1' }],
            DocumentMetadata: { Pages: 3 },
            NextToken: 'next',
          }
        }
        return { JobStatus: 'SUCCEEDED', Blocks: [{ Id: '2' }] }
      },
      (accumulated, page) => ({
        ...accumulated,
        ...page,
        Blocks: [...(accumulated.Blocks ?? []), ...(page.Blocks ?? [])],
      })
    )

    expect(result.Blocks).toHaveLength(2)
    expect(result.DocumentMetadata).toEqual({ Pages: 3 })
  })

  it('throws when the job fails', async () => {
    await expect(
      pollTextractJob(
        'request-4',
        logger,
        async () => ({ JobStatus: 'FAILED', StatusMessage: 'boom' }),
        (accumulated) => accumulated
      )
    ).rejects.toThrow('Textract job failed: boom')
  })

  it('propagates cancellation before polling', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      pollTextractJob(
        'request-5',
        logger,
        async () => ({ JobStatus: 'SUCCEEDED' }),
        (accumulated) => accumulated,
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
