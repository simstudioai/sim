/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { describe, expect, it } from 'vitest'
import {
  inferContextFromKey,
  isAbortError,
  isInternalFileUrl,
  isNetworkError,
  processSingleFileToUserFile,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FileUtilsTest')

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

describe('inferContextFromKey', () => {
  it('maps both kb/ and knowledge-base/ prefixes to knowledge-base', () => {
    expect(inferContextFromKey('kb/1700000000000-doc.pdf')).toBe('knowledge-base')
    // Direct/presigned uploads key as `${context}/...`, i.e. `knowledge-base/...`
    expect(inferContextFromKey('knowledge-base/1781612506186-b2442e0dc045cb6c-doc.txt')).toBe(
      'knowledge-base'
    )
  })

  it('maps the remaining context prefixes', () => {
    expect(inferContextFromKey('chat/x')).toBe('chat')
    expect(inferContextFromKey('copilot/x')).toBe('copilot')
    expect(inferContextFromKey('execution/ws/wf/ex/x')).toBe('execution')
    expect(inferContextFromKey('workspace/ws/x')).toBe('workspace')
    expect(inferContextFromKey('profile-pictures/x')).toBe('profile-pictures')
    expect(inferContextFromKey('og-images/x')).toBe('og-images')
    expect(inferContextFromKey('workspace-logos/x')).toBe('workspace-logos')
    expect(inferContextFromKey('logs/x')).toBe('logs')
  })

  it('throws for empty or unrecognized keys', () => {
    expect(() => inferContextFromKey('')).toThrow()
    expect(() => inferContextFromKey('mystery/x')).toThrow()
  })
})

describe('resolveTrustedFileContext', () => {
  it('derives from the key prefix and ignores a mismatched caller context', () => {
    expect(resolveTrustedFileContext('workspace/ws/1700000000000-abc-x.pdf', 'og-images')).toBe(
      'workspace'
    )
    expect(resolveTrustedFileContext('chat/x', 'workspace-logos')).toBe('chat')
    expect(resolveTrustedFileContext('workspace/ws/x', 'mothership')).toBe('workspace')
  })

  it('honors the caller context for legacy keys with no inferrable prefix', () => {
    expect(resolveTrustedFileContext('legacy/ws/wf/ex/report.pdf', 'execution')).toBe('execution')
  })

  it('never resolves an un-inferrable key to a world-readable context', () => {
    expect(() => resolveTrustedFileContext('legacy/report.pdf', 'og-images')).toThrow()
    expect(() => resolveTrustedFileContext('legacy/report.pdf', 'profile-pictures')).toThrow()
    expect(() => resolveTrustedFileContext('legacy/report.pdf')).toThrow()
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

describe('processSingleFileToUserFile', () => {
  it('strips server-only provider file handles from untrusted input', () => {
    const result = processSingleFileToUserFile(
      {
        id: 'file-1',
        name: 'doc.pdf',
        url: '/api/files/serve/workspace%2Fws-1%2Fdoc.pdf?context=workspace',
        size: 1024,
        type: 'application/pdf',
        key: 'workspace/ws-1/doc.pdf',
        providerFileId: 'file-injected',
        providerFileUri: 'https://injected/uri',
        remoteUrl: 'http://169.254.169.254/latest/meta-data',
      } as never,
      'req-1',
      logger
    )

    expect(result.providerFileId).toBeUndefined()
    expect(result.providerFileUri).toBeUndefined()
    expect(result.remoteUrl).toBeUndefined()
    expect(result.key).toBe('workspace/ws-1/doc.pdf')
  })
})
