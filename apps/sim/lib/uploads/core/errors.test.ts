/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'

describe('isObjectNotFoundError', () => {
  it('matches the shapes each storage provider uses for a missing object', () => {
    /** S3 HeadObject, exactly as the production payload arrived. */
    expect(
      isObjectNotFoundError({
        name: 'NotFound',
        $fault: 'client',
        $metadata: { httpStatusCode: 404 },
      })
    ).toBe(true)
    /** S3 GetObject. */
    expect(isObjectNotFoundError({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })).toBe(
      true
    )
    /** Azure Blob. */
    expect(isObjectNotFoundError({ code: 'BlobNotFound', statusCode: 404 })).toBe(true)
    /** GCS, which reports a numeric code. */
    expect(isObjectNotFoundError({ code: 404 })).toBe(true)
  })

  it('reads the label from code when name carries the error class instead', () => {
    /** Azure raises a `RestError`; the reason lives in `code`, not `name`. */
    expect(isObjectNotFoundError({ name: 'RestError', code: 'BlobNotFound' })).toBe(true)
    expect(isObjectNotFoundError({ name: 'Error', code: 'NoSuchKey' })).toBe(true)
  })

  it('does not read a missing bucket or container as an absent object', () => {
    /**
     * These answer 404 too. Reading them as absence would turn a total storage
     * misconfiguration into silent fail-closed reads with nothing to alert on.
     */
    expect(
      isObjectNotFoundError({ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } })
    ).toBe(false)
    expect(
      isObjectNotFoundError({ name: 'RestError', code: 'ContainerNotFound', statusCode: 404 })
    ).toBe(false)
  })

  it('matches on status alone when the provider sends no label', () => {
    expect(isObjectNotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true)
    expect(isObjectNotFoundError({ statusCode: 404 })).toBe(true)
  })

  it('does not swallow a genuine failure', () => {
    expect(
      isObjectNotFoundError({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
    ).toBe(false)
    expect(
      isObjectNotFoundError({ name: 'InternalError', $metadata: { httpStatusCode: 500 } })
    ).toBe(false)
    expect(isObjectNotFoundError({ name: 'TimeoutError' })).toBe(false)
    expect(isObjectNotFoundError({ code: 'ECONNRESET' })).toBe(false)
    expect(isObjectNotFoundError({ code: 403 })).toBe(false)
  })

  it('tolerates values that are not error objects', () => {
    expect(isObjectNotFoundError(null)).toBe(false)
    expect(isObjectNotFoundError(undefined)).toBe(false)
    expect(isObjectNotFoundError('NotFound')).toBe(false)
    expect(isObjectNotFoundError(404)).toBe(false)
  })
})
