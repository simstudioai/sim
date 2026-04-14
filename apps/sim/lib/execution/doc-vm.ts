/**
 * Sandboxed document generation via subprocess.
 *
 * Supports pptx (pptxgenjs), docx (docx), and pdf (pdf-lib).
 * User code runs in a separate Node.js child process. File access is brokered
 * via IPC -- the subprocess never touches the database directly.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import {
  downloadWorkspaceFile,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('DocVMExecution')

export type DocumentFormat = 'pptx' | 'docx' | 'pdf'

const WORKER_STARTUP_TIMEOUT_MS = 10_000
const GENERATION_TIMEOUT_MS = 60_000
const MAX_STDERR = 4096

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; data: string }
  | { type: 'error'; message: string }
  | { type: 'getFile'; fileReqId: number; fileId: string }

const currentDir = path.dirname(fileURLToPath(import.meta.url))
let cachedWorkerPath: string | undefined

function getWorkerPath(): string {
  if (cachedWorkerPath) return cachedWorkerPath
  const candidates = [
    path.join(currentDir, '..', '..', 'dist', 'doc-worker.cjs'),
    path.join(currentDir, 'doc-worker.cjs'),
    path.join(process.cwd(), 'apps', 'sim', 'dist', 'doc-worker.cjs'),
    path.join(process.cwd(), 'apps', 'sim', 'lib', 'execution', 'doc-worker.cjs'),
    path.join(process.cwd(), 'dist', 'doc-worker.cjs'),
    path.join(process.cwd(), 'lib', 'execution', 'doc-worker.cjs'),
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) throw new Error(`doc-worker.cjs not found at any of: ${candidates.join(', ')}`)
  cachedWorkerPath = found
  return found
}

export async function generateDocumentFromCode(
  format: DocumentFormat,
  code: string,
  workspaceId: string,
  signal?: AbortSignal
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let proc: ChildProcess | null = null
    let settled = false
    let startupTimer: ReturnType<typeof setTimeout> | null = null
    let generationTimer: ReturnType<typeof setTimeout> | null = null

    function done(err: Error): void
    function done(err: undefined, result: Buffer): void
    function done(err: Error | undefined, result?: Buffer): void {
      if (settled) return
      settled = true
      if (startupTimer) clearTimeout(startupTimer)
      if (generationTimer) clearTimeout(generationTimer)
      try {
        proc?.removeAllListeners()
        proc?.kill()
      } catch {
        // Ignore -- process may have already exited
      }
      if (err) reject(err)
      else resolve(result as Buffer)
    }

    if (signal?.aborted) {
      reject(new Error(`${format.toUpperCase()} generation cancelled`))
      return
    }

    signal?.addEventListener(
      'abort',
      () => done(new Error(`${format.toUpperCase()} generation cancelled`)),
      { once: true }
    )

    try {
      proc = spawn('node', [getWorkerPath()], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'json',
        env: { PATH: process.env.PATH ?? '' } as unknown as NodeJS.ProcessEnv,
      })
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)))
      return
    }

    let stderrData = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderrData.length < MAX_STDERR) {
        stderrData += chunk.toString()
        if (stderrData.length > MAX_STDERR) stderrData = stderrData.slice(0, MAX_STDERR)
      }
    })

    startupTimer = setTimeout(() => {
      logger.error(`${format} worker failed to start within timeout`)
      done(new Error(`${format.toUpperCase()} worker failed to start`))
    }, WORKER_STARTUP_TIMEOUT_MS)

    proc.on('exit', (code) => {
      if (!settled) {
        logger.error(`${format} worker exited unexpectedly`, {
          code,
          stderr: stderrData.slice(0, 500),
        })
        done(new Error(`${format.toUpperCase()} worker exited unexpectedly (code ${code})`))
      }
    })

    proc.on('error', (err) => {
      logger.error(`${format} worker process error`, { error: err.message })
      done(err)
    })

    proc.on('message', (rawMsg: unknown) => {
      const msg = rawMsg as WorkerMessage

      if (msg.type === 'ready') {
        if (startupTimer) {
          clearTimeout(startupTimer)
          startupTimer = null
        }
        generationTimer = setTimeout(() => {
          logger.error(`${format} generation timed out`)
          done(new Error(`${format.toUpperCase()} generation timed out`))
        }, GENERATION_TIMEOUT_MS)
        proc!.send({ type: 'generate', format, code })
        return
      }

      if (msg.type === 'result') {
        done(undefined, Buffer.from(msg.data, 'base64'))
        return
      }

      if (msg.type === 'error') {
        done(new Error(msg.message))
        return
      }

      if (msg.type === 'getFile') {
        handleFileRequest(proc!, workspaceId, msg).catch((err) => {
          logger.error(`Failed to handle file request from ${format} worker`, {
            fileId: msg.fileId,
            error: err instanceof Error ? err.message : String(err),
          })
          if (proc && !settled) {
            try {
              proc.send({
                type: 'fileResult',
                fileReqId: msg.fileReqId,
                error: err instanceof Error ? err.message : 'File fetch failed',
              })
            } catch {
              // Ignore -- process may have died
            }
          }
        })
      }
    })
  })
}

async function handleFileRequest(
  proc: ChildProcess,
  workspaceId: string,
  msg: Extract<WorkerMessage, { type: 'getFile' }>
): Promise<void> {
  const record = await getWorkspaceFile(workspaceId, msg.fileId)
  if (!record) {
    proc.send({
      type: 'fileResult',
      fileReqId: msg.fileReqId,
      error: `File not found: ${msg.fileId}`,
    })
    return
  }

  const buffer = await downloadWorkspaceFile(record)
  const mime = record.type || 'image/png'
  proc.send({
    type: 'fileResult',
    fileReqId: msg.fileReqId,
    data: `data:${mime};base64,${buffer.toString('base64')}`,
  })
}

export const generatePptxFromCode = (code: string, workspaceId: string, signal?: AbortSignal) =>
  generateDocumentFromCode('pptx', code, workspaceId, signal)

export const generateDocxFromCode = (code: string, workspaceId: string, signal?: AbortSignal) =>
  generateDocumentFromCode('docx', code, workspaceId, signal)

export const generatePdfFromCode = (code: string, workspaceId: string, signal?: AbortSignal) =>
  generateDocumentFromCode('pdf', code, workspaceId, signal)
