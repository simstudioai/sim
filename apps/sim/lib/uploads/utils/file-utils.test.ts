/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isAbortError, isInternalFileUrl, isNetworkError } from '@/lib/uploads/utils/file-utils'

describe('isInternalFileUrl', () => {
  it('classifies relative serve paths as internal', () => {
    expect(isInternalFileUrl('/api/files/serve/kb/123-file.pdf')).toBe(true)
    expect(isInternalFileUrl('/api/files/serve/workspace/ws-1/file.txt?context=workspace')).toBe(
      true
    )
  })

  it('classifies absolute serve URLs as internal regardless of host', () => {
    expect(isInternalFileUrl('https://www.sim.ai/api/files/serve/kb/x.pdf')).toBe(true)
    expect(isInternalFileUrl('http://localhost:3000/api/files/serve/blob/kb/x')).toBe(true)
    // Host is not used to gate (self-hosted/multi-domain); the storage sink authorizes.
    expect(isInternalFileUrl('https://other-host/api/files/serve/workspace/v/x')).toBe(true)
  })

  it('does not match the marker outside the path (query/fragment)', () => {
    expect(isInternalFileUrl('https://evil.com/x?next=/api/files/serve/secret')).toBe(false)
    expect(isInternalFileUrl('https://evil.com/page#/api/files/serve/secret')).toBe(false)
    expect(isInternalFileUrl('https://evil.com/redirect?u=/api/files/serve/kb/x')).toBe(false)
  })

  it('preserves traversal sequences so they survive downstream rejection', () => {
    // Must stay internal (not normalized away) so the parse route applies its `..` check.
    expect(isInternalFileUrl('https://attacker.com/api/files/serve/../../../etc/passwd')).toBe(true)
    expect(isInternalFileUrl('/api/files/serve/../../app.js')).toBe(true)
  })

  it('returns false for non-internal and non-string inputs', () => {
    expect(isInternalFileUrl('https://example.com/file.pdf')).toBe(false)
    expect(isInternalFileUrl('data:text/plain;base64,abc')).toBe(false)
    // @ts-expect-error verifying runtime guard
    expect(isInternalFileUrl(undefined)).toBe(false)
  })
})

describe('isAbortError', () => {
  it('returns true for AbortError-named errors', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(isAbortError(err)).toBe(true)
  })

  it('returns false for generic Errors', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})

describe('isNetworkError', () => {
  it.each([
    'fetch failed',
    'Network request failed',
    'connection reset',
    'request timeout',
    'operation timed out',
    'ECONNRESET while reading body',
  ])('matches transient message %s', (msg) => {
    expect(isNetworkError(new Error(msg))).toBe(true)
  })

  it('does not match deterministic errors', () => {
    expect(isNetworkError(new Error('Forbidden'))).toBe(false)
    expect(isNetworkError(new Error('Validation failed: name is required'))).toBe(false)
    expect(isNetworkError('not an error')).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})
