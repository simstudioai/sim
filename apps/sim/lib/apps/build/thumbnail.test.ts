import { describe, expect, it } from 'vitest'
import {
  captureLocalArtifactThumbnail,
  thumbnailDiagnosticsFromCommand,
} from '@/lib/apps/build/thumbnail'

describe('thumbnailDiagnosticsFromCommand', () => {
  it('records successful capture without build-sensitive output', () => {
    expect(
      thumbnailDiagnosticsFromCommand({
        exitCode: 0,
        stdout: '{"status":"captured"}',
        stderr: '',
      })
    ).toEqual({ status: 'captured', path: 'preview.webp' })
  })

  it('turns capture errors and timeouts into non-fatal diagnostics', () => {
    expect(
      thumbnailDiagnosticsFromCommand({
        exitCode: 1,
        stdout: '',
        stderr: 'browser unavailable',
      })
    ).toEqual({
      status: 'failed',
      path: 'preview.webp',
      error: 'browser unavailable',
      exitCode: 1,
    })

    expect(
      thumbnailDiagnosticsFromCommand({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true,
      })
    ).toMatchObject({
      status: 'failed',
      path: 'preview.webp',
      timedOut: true,
    })
  })

  it('returns diagnostics instead of rejecting when the local capture process fails', async () => {
    const result = await captureLocalArtifactThumbnail({
      scriptPath: '/definitely/missing/capture-thumbnail.mjs',
      distDir: '/definitely/missing/dist',
      timeoutMs: 5_000,
    })

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.error).toBeTruthy()
    }
  })
})
