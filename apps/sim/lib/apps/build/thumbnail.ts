import { spawn } from 'node:child_process'

export const APP_THUMBNAIL_PATH = 'preview.webp'
export const THUMBNAIL_CAPTURE_TIMEOUT_MS = 30_000

export type ThumbnailCaptureDiagnostics =
  | { status: 'captured'; path: typeof APP_THUMBNAIL_PATH }
  | {
      status: 'failed'
      path: typeof APP_THUMBNAIL_PATH
      error: string
      exitCode?: number | null
      timedOut?: boolean
    }

export type ThumbnailCaptureCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
}

export function thumbnailDiagnosticsFromCommand(
  result: ThumbnailCaptureCommandResult
): ThumbnailCaptureDiagnostics {
  if (result.exitCode === 0 && !result.timedOut) {
    return { status: 'captured', path: APP_THUMBNAIL_PATH }
  }

  const output = (result.stderr || result.stdout || 'Thumbnail capture failed').trim()
  return {
    status: 'failed',
    path: APP_THUMBNAIL_PATH,
    error: output.slice(0, 1000),
    exitCode: result.exitCode,
    ...(result.timedOut ? { timedOut: true } : {}),
  }
}

/** Runs the trusted capture script out-of-process; failure never fails the parent build. */
export function captureLocalArtifactThumbnail(params: {
  scriptPath: string
  distDir: string
  timeoutMs?: number
}): Promise<ThumbnailCaptureDiagnostics> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [params.scriptPath, params.distDir], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (result: ThumbnailCaptureCommandResult) => {
      if (settled) return
      settled = true
      resolvePromise(thumbnailDiagnosticsFromCommand(result))
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, params.timeoutMs ?? THUMBNAIL_CAPTURE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ exitCode: 1, stdout, stderr: stderr || error.message, timedOut })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      finish({ exitCode, stdout, stderr, timedOut })
    })
  })
}
