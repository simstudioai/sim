import { createLogger } from '@sim/logger'
import { describe, expect, it } from 'vitest'
import {
  extractStorageKey,
  extractWorkspaceIdFromStorageKey,
  inferContextFromKey,
  isInternalFileUrl,
  isNetworkError,
  processSingleFileToUserFile,
  resolveEffectiveMimeType,
  resolveFileType,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FileUtilsTest')

describe('extractStorageKey', () => {
  it('strips every provider serve prefix', () => {
    expect(extractStorageKey('/api/files/serve/s3/workspace%2Fws-1%2Ffile.txt')).toBe(
      'workspace/ws-1/file.txt'
    )
    expect(extractStorageKey('/api/files/serve/blob/workspace%2Fws-1%2Ffile.txt')).toBe(
      'workspace/ws-1/file.txt'
    )
    expect(extractStorageKey('/api/files/serve/gcs/workspace%2Fws-1%2Ffile.txt')).toBe(
      'workspace/ws-1/file.txt'
    )
  })
})

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
})

describe('inferContextFromKey', () => {
  it('maps both kb/ and knowledge-base/ prefixes to knowledge-base', () => {
    expect(inferContextFromKey('kb/1700000000000-doc.pdf')).toBe('knowledge-base')
    // Direct/presigned uploads key as `${context}/...`, i.e. `knowledge-base/...`
    expect(inferContextFromKey('knowledge-base/1781612506186-b2442e0dc045cb6c-doc.txt')).toBe(
      'knowledge-base'
    )
  })

  it('throws for empty or unrecognized keys', () => {
    expect(() => inferContextFromKey('')).toThrow()
    expect(() => inferContextFromKey('mystery/x')).toThrow()
  })
})

describe('extractWorkspaceIdFromStorageKey', () => {
  const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
  const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333'
  const EXECUTION_ID = '44444444-4444-4444-8444-444444444444'

  it('reads the workspace out of the two key layouts that name one', () => {
    expect(
      extractWorkspaceIdFromStorageKey(`workspace/${WORKSPACE_ID}/1700000000000-abc-x.pdf`)
    ).toBe(WORKSPACE_ID)
    expect(
      extractWorkspaceIdFromStorageKey(
        `execution/${WORKSPACE_ID}/${WORKFLOW_ID}/${EXECUTION_ID}/x.png`
      )
    ).toBe(WORKSPACE_ID)
  })

  it('returns null for key layouts that name no workspace', () => {
    expect(extractWorkspaceIdFromStorageKey('chat/x')).toBeNull()
    expect(extractWorkspaceIdFromStorageKey('kb/x')).toBeNull()
    expect(extractWorkspaceIdFromStorageKey('copilot/x')).toBeNull()
    expect(extractWorkspaceIdFromStorageKey('profile-pictures/x')).toBeNull()
    expect(extractWorkspaceIdFromStorageKey('')).toBeNull()
  })

  it('refuses a workspace segment that is not a workspace id', () => {
    expect(extractWorkspaceIdFromStorageKey('workspace/other-tenant/x.pdf')).toBeNull()
    expect(extractWorkspaceIdFromStorageKey(`workspace/${WORKSPACE_ID}`)).toBeNull()
  })
})

describe('resolveTrustedFileContext', () => {
  it('derives from the key prefix and ignores a mismatched caller context', () => {
    expect(resolveTrustedFileContext('workspace/ws/1700000000000-abc-x.pdf', 'og-images')).toBe(
      'workspace'
    )
    expect(resolveTrustedFileContext('chat/x', 'workspace-logos')).toBe('chat')
    expect(resolveTrustedFileContext('chat/x', 'organization-logos')).toBe('chat')
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

describe('resolveEffectiveMimeType', () => {
  it('resolves binary/octet-stream and blank stored types too', () => {
    expect(resolveEffectiveMimeType('binary/octet-stream', 'clip.mp4')).toBe('video/mp4')
    expect(resolveEffectiveMimeType('  ', 'clip.mp4')).toBe('video/mp4')
    expect(resolveEffectiveMimeType(null, 'clip.mp4')).toBe('video/mp4')
    expect(resolveEffectiveMimeType(undefined, 'clip.mp4')).toBe('video/mp4')
  })

  it('resolves a dual audio/video container to video, matching how the app presents it', () => {
    expect(resolveEffectiveMimeType('application/octet-stream', 'clip.webm')).toBe('video/webm')
    expect(resolveEffectiveMimeType(null, 'clip.webm')).toBe('video/webm')
  })

  it('never lets the video default reach the type that gets persisted', () => {
    // resolveFileType writes user_file.content_type, which the speech-to-text route reads
    // back as file.type — a video/* value there sends the upload into ffmpeg extraction.
    expect(resolveFileType({ type: '', name: 'clip.webm' })).toBe('audio/webm')
    expect(resolveFileType({ type: 'application/octet-stream', name: 'clip.webm' })).toBe(
      'audio/webm'
    )
    expect(resolveFileType({ type: 'audio/webm', name: 'clip.webm' })).toBe('audio/webm')
  })
})
