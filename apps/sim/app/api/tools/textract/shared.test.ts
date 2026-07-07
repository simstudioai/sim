/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { describe, expect, it } from 'vitest'
import {
  mapTextractSdkError,
  parseS3Uri,
  pollTextractJob,
  TextractRouteError,
} from '@/app/api/tools/textract/shared'

const logger = createLogger('TextractSharedTest')

describe('parseS3Uri', () => {
  it('parses a valid s3 URI', () => {
    expect(parseS3Uri('s3://my-bucket/path/to/doc.pdf')).toEqual({
      bucket: 'my-bucket',
      key: 'path/to/doc.pdf',
    })
  })

  it('rejects a malformed URI', () => {
    expect(() => parseS3Uri('not-an-s3-uri')).toThrow(TextractRouteError)
  })

  it('rejects path traversal in the key', () => {
    expect(() => parseS3Uri('s3://my-bucket/../secrets.pdf')).toThrow('path traversal')
  })
})

describe('mapTextractSdkError', () => {
  it('gives a friendly hint for unsupported PDFs in single-page mode', () => {
    const mapped = mapTextractSdkError(
      { name: 'UnsupportedDocumentException', message: 'Unsupported document' },
      true
    )
    expect(mapped.status).toBe(400)
    expect(mapped.message).toContain('Multi-Page (PDF, TIFF via S3)')
  })

  it('omits the multi-page hint for operations without an async mode', () => {
    const mapped = mapTextractSdkError(
      { name: 'UnsupportedDocumentException', message: 'Unsupported document' },
      true,
      { hasAsyncMode: false }
    )
    expect(mapped.message).not.toContain('Multi-Page')
    expect(mapped.message).toContain('Only JPEG, PNG, and single-page PDF files are supported')
  })

  it('does not rewrite the message for non-PDF unsupported documents', () => {
    const mapped = mapTextractSdkError(
      { name: 'UnsupportedDocumentException', message: 'Unsupported document' },
      false
    )
    expect(mapped.message).toBe('Unsupported document')
  })

  it('uses the SDK http status when under 500', () => {
    const mapped = mapTextractSdkError(
      {
        name: 'InvalidParameterException',
        message: 'Bad param',
        $metadata: { httpStatusCode: 400 },
      },
      false
    )
    expect(mapped.status).toBe(400)
    expect(mapped.message).toBe('Bad param')
  })

  it('passes through a 5xx SDK status so tool-execution retry logic still fires', () => {
    const mapped = mapTextractSdkError(
      { message: 'Internal failure', $metadata: { httpStatusCode: 500 } },
      false
    )
    expect(mapped.status).toBe(500)
  })

  it('defaults to 400 when the SDK gives no http status', () => {
    const mapped = mapTextractSdkError({ message: 'Unknown failure' }, false)
    expect(mapped.status).toBe(400)
  })
})

describe('pollTextractJob', () => {
  it('returns immediately on SUCCEEDED with no NextToken', async () => {
    const result = await pollTextractJob(
      'req-1',
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

  it('follows NextToken pagination and merges pages', async () => {
    let calls = 0
    const result = await pollTextractJob(
      'req-2',
      logger,
      async (nextToken) => {
        calls += 1
        if (!nextToken) return { JobStatus: 'SUCCEEDED', Blocks: [{ Id: '1' }], NextToken: 'next' }
        return { JobStatus: 'SUCCEEDED', Blocks: [{ Id: '2' }] }
      },
      (accumulated, page) => ({
        ...page,
        Blocks: [...(accumulated.Blocks ?? []), ...(page.Blocks ?? [])],
      })
    )

    expect(calls).toBe(2)
    expect(result.Blocks).toHaveLength(2)
  })

  it('throws a TextractRouteError when the job fails', async () => {
    await expect(
      pollTextractJob(
        'req-3',
        logger,
        async () => ({ JobStatus: 'FAILED', StatusMessage: 'boom' }),
        (accumulated) => accumulated
      )
    ).rejects.toThrow('Textract job failed: boom')
  })
})
