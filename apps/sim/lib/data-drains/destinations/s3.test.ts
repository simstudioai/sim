/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend, mockDestroy, S3ClientCtor, PutObjectCommandCtor, DeleteObjectCommandCtor } =
  vi.hoisted(() => {
    const mockSend = vi.fn(async () => ({}))
    const mockDestroy = vi.fn()
    return {
      mockSend,
      mockDestroy,
      S3ClientCtor: vi.fn(() => ({ send: mockSend, destroy: mockDestroy })),
      PutObjectCommandCtor: vi.fn((args: unknown) => ({ __cmd: 'put', args })),
      DeleteObjectCommandCtor: vi.fn((args: unknown) => ({ __cmd: 'delete', args })),
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

beforeEach(() => {
  vi.clearAllMocks()
})

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

  it('omits the prefix segment when prefix is empty', async () => {
    const session = s3Destination.openSession({
      config: { bucket: 'b', region: 'us-east-1' },
      credentials,
    })
    const result = await session.deliver({
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
    expect(result.locator).toMatch(
      /^s3:\/\/b\/audit_logs\/d\/\d{4}\/\d{2}\/\d{2}\/r-00000\.ndjson$/
    )
    await session.close()
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

describe('s3Destination test()', () => {
  it('writes a probe object then attempts cleanup', async () => {
    await s3Destination.test!({
      config,
      credentials,
      signal: new AbortController().signal,
    })
    expect(PutObjectCommandCtor).toHaveBeenCalled()
    expect(DeleteObjectCommandCtor).toHaveBeenCalled()
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('still returns success when cleanup delete fails', async () => {
    mockSend
      .mockResolvedValueOnce({}) // put probe
      .mockRejectedValueOnce(new Error('no delete perms')) // cleanup
    await expect(
      s3Destination.test!({ config, credentials, signal: new AbortController().signal })
    ).resolves.toBeUndefined()
  })
})
