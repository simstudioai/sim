/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseS3Uri } from '@/lib/internal/textract/document-input'
import { TextractOperationError } from '@/lib/internal/textract/errors'

describe('parseS3Uri', () => {
  it('parses a valid S3 URI', () => {
    expect(parseS3Uri('s3://my-bucket/path/to/doc.pdf')).toEqual({
      bucket: 'my-bucket',
      key: 'path/to/doc.pdf',
    })
  })

  it('rejects a malformed URI', () => {
    expect(() => parseS3Uri('not-an-s3-uri')).toThrow(TextractOperationError)
  })

  it('rejects path traversal in the key', () => {
    expect(() => parseS3Uri('s3://my-bucket/../secrets.pdf')).toThrow('path traversal')
  })
})
