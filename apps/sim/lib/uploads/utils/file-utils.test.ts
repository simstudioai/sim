/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { describe, expect, it } from 'vitest'
import {
  ensureFileNameExtension,
  extractStorageKey,
  extractWorkspaceIdFromStorageKey,
  getExtensionFromMimeType,
  getMimeTypeFromExtension,
  inferContextFromKey,
  isAbortError,
  isInternalFileUrl,
  isMarkdownFile,
  isNetworkError,
  processSingleFileToUserFile,
  resolveEffectiveMimeType,
  resolveFileType,
  resolveMediaMimeType,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FileUtilsTest')

describe('isMarkdownFile', () => {
  it('is true for .md and .markdown (case-insensitive)', () => {
    expect(isMarkdownFile({ name: 'notes.md' })).toBe(true)
    expect(isMarkdownFile({ name: 'README.MD' })).toBe(true)
    expect(isMarkdownFile({ name: 'doc.markdown' })).toBe(true)
  })

  it('is true for a text/markdown MIME even without a .md name', () => {
    expect(isMarkdownFile({ type: 'text/markdown', name: 'notes' })).toBe(true)
    expect(isMarkdownFile({ type: 'text/markdown', name: 'doc.txt' })).toBe(true)
  })

  it('is false for non-markdown files', () => {
    expect(isMarkdownFile({ type: 'text/javascript', name: 'script.js' })).toBe(false)
    expect(isMarkdownFile({ name: 'report.docx' })).toBe(false)
    expect(isMarkdownFile({ type: 'text/plain', name: 'notes.txt' })).toBe(false)
    expect(isMarkdownFile({ name: 'noext' })).toBe(false)
  })
})

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

  it('returns unprefixed serve keys as-is', () => {
    expect(extractStorageKey('/api/files/serve/kb/123-doc.pdf')).toBe('kb/123-doc.pdf')
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

describe('resolveEffectiveMimeType', () => {
  it('keeps a specific stored type', () => {
    expect(resolveEffectiveMimeType('video/quicktime', 'clip.mp4')).toBe('video/quicktime')
    expect(resolveEffectiveMimeType('text/markdown', 'notes.md')).toBe('text/markdown')
  })

  it.each([
    ['clip.mp4', 'video/mp4'],
    ['clip.mov', 'video/quicktime'],
    ['clip.mkv', 'video/x-matroska'],
    ['song.mp3', 'audio/mpeg'],
    ['song.flac', 'audio/flac'],
    ['icon.ico', 'image/x-icon'],
    ['shot.avif', 'image/avif'],
  ])('resolves a stored application/octet-stream for %s from the extension', (name, expected) => {
    expect(resolveEffectiveMimeType('application/octet-stream', name)).toBe(expected)
  })

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

  it('still keeps an explicit audio/webm declared by the browser', () => {
    expect(resolveEffectiveMimeType('audio/webm', 'recording.webm')).toBe('audio/webm')
  })

  it('leaves the upload-time extension table alone for dual containers', () => {
    expect(getMimeTypeFromExtension('webm')).toBe('audio/webm')
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

  it('stays generic when the extension identifies nothing either', () => {
    expect(resolveEffectiveMimeType('application/octet-stream', 'firmware.bin')).toBe(
      'application/octet-stream'
    )
    expect(resolveEffectiveMimeType(null, 'firmware.bin')).toBe('application/octet-stream')
    expect(resolveEffectiveMimeType('', 'noextension')).toBe('application/octet-stream')
  })
})

describe('resolveMediaMimeType', () => {
  it('resolves a generic stored type from the extension', () => {
    expect(resolveMediaMimeType('application/octet-stream', 'clip.mp4', 'video')).toBe('video/mp4')
    expect(resolveMediaMimeType('application/octet-stream', 'song.flac', 'audio')).toBe(
      'audio/flac'
    )
  })

  it('retags a dual audio/video container to the kind being rendered', () => {
    expect(resolveMediaMimeType(null, 'clip.webm', 'video')).toBe('video/webm')
    expect(resolveMediaMimeType('audio/webm', 'clip.webm', 'video')).toBe('video/webm')
    expect(resolveMediaMimeType(null, 'recording.webm', 'audio')).toBe('audio/webm')
    expect(resolveMediaMimeType('video/webm', 'recording.webm', 'audio')).toBe('audio/webm')
  })

  it('keeps a specific type that already names the right kind', () => {
    expect(resolveMediaMimeType('video/quicktime', 'clip.mov', 'video')).toBe('video/quicktime')
    expect(resolveMediaMimeType('audio/opus', 'voice.opus', 'audio')).toBe('audio/opus')
  })

  it('falls back to the kind default when nothing names a media format', () => {
    expect(resolveMediaMimeType('application/zip', 'weird.bin', 'audio')).toBe('audio/mpeg')
    expect(resolveMediaMimeType(null, 'weird.bin', 'video')).toBe('video/mp4')
  })
})

describe('getExtensionFromMimeType', () => {
  it('ignores content-type parameters', () => {
    expect(getExtensionFromMimeType('image/png')).toBe('png')
    expect(getExtensionFromMimeType('text/html; charset=utf-8')).toBe('html')
    expect(getExtensionFromMimeType('application/octet-stream')).toBeNull()
  })
})

describe('ensureFileNameExtension', () => {
  it('appends the content-type extension only when the name has none', () => {
    expect(ensureFileNameExtension('navbar_2', 'image/png')).toBe('navbar_2.png')
    expect(ensureFileNameExtension('download (641)', 'image/jpeg; charset=binary')).toBe(
      'download (641).jpg'
    )
    expect(ensureFileNameExtension('hero.png', 'image/jpeg')).toBe('hero.png')
    expect(ensureFileNameExtension('site.webmanifest', 'application/json')).toBe('site.webmanifest')
    expect(ensureFileNameExtension('Sim.ai <> RVTech', 'text/html')).toBe('Sim.ai <> RVTech.html')
    expect(ensureFileNameExtension('blob', 'application/octet-stream')).toBe('blob')
    expect(ensureFileNameExtension('blob', null)).toBe('blob')
  })
})
