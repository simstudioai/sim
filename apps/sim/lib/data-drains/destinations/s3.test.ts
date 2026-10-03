import { describe, expect, it, vi } from 'vitest'

const { mockSend, mockDestroy, S3ClientCtor, PutObjectCommandCtor, DeleteObjectCommandCtor } =
  vi.hoisted(() => {
    const mockSend = vi.fn(async () => ({}))
    const mockDestroy = vi.fn()
    return {
      mockSend,
      mockDestroy,
      S3ClientCtor: vi.fn().mockImplementation(
        class {
          send = mockSend
          destroy = mockDestroy
        }
      ),
      PutObjectCommandCtor: vi.fn().mockImplementation(
        class {
          __cmd = 'put'
          args: unknown
          constructor(args: unknown) {
            this.args = args
          }
        }
      ),
      DeleteObjectCommandCtor: vi.fn().mockImplementation(
        class {
          __cmd = 'delete'
          args: unknown
          constructor(args: unknown) {
            this.args = args
          }
        }
      ),
    }
  })

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: S3ClientCtor,
  PutObjectCommand: PutObjectCommandCtor,
  DeleteObjectCommand: DeleteObjectCommandCtor,
}))

import { s3Destination } from '@/lib/data-drains/destinations/s3'

const config = {
  bucket: 'my-bucket',
  region: 'us-east-1',
  prefix: 'sim/',
}
const credentials = { accessKeyId: 'AKID', secretAccessKey: 'SECRET' }

describe('s3Destination openSession', () => {
  it('reuses one S3Client across multiple deliveries and destroys on close', async () => {
    const session = s3Destination.openSession({ config, credentials })
    expect(S3ClientCtor).toHaveBeenCalledTimes(1)

    const body = Buffer.from('row\n', 'utf8')
    const meta = (sequence: number) => ({
      drainId: 'd1',
      runId: 'r1',
      source: 'workflow_logs' as const,
      sequence,
      rowCount: 1,
      runStartedAt: new Date('2025-06-15T12:00:00Z'),
    })
    const signal = new AbortController().signal

    const res1 = await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: meta(0),
      signal,
    })
    const res2 = await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: meta(1),
      signal,
    })

    expect(S3ClientCtor).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledTimes(2)

    expect(res1.locator).toMatch(
      /^s3:\/\/my-bucket\/sim\/workflow_logs\/d1\/\d{4}\/\d{2}\/\d{2}\/r1-00000\.ndjson$/
    )
    expect(res2.locator).toMatch(/r1-00001\.ndjson$/)

    const putArgs = (PutObjectCommandCtor.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(putArgs.Bucket).toBe('my-bucket')
    expect(putArgs.Body).toBe(body)
    expect(putArgs.ContentType).toBe('application/x-ndjson')
    expect((putArgs.Metadata as Record<string, string>)['sim-drain-id']).toBe('d1')
    expect((putArgs.Metadata as Record<string, string>)['sim-sequence']).toBe('0')

    await session.close()
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('surfaces AWS error code in delivery errors', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403, requestId: 'req-1' },
      })
    )
    const session = s3Destination.openSession({ config, credentials })
    await expect(
      session.deliver({
        body: Buffer.from('x'),
        contentType: 'application/x-ndjson',
        metadata: {
          drainId: 'd',
          runId: 'r',
          source: 'audit_logs',
          sequence: 0,
          rowCount: 1,
          runStartedAt: new Date('2025-06-15T12:00:00Z'),
        },
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/AccessDenied 403/)
    await session.close()
  })
})
