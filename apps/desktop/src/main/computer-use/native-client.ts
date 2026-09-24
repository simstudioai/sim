import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { ComputerUseError } from '@sim/desktop-bridge'
import {
  ComputerUseNativeReplySchema,
  type ComputerUseResult,
} from '@sim/desktop-bridge/computer-use'
import { generateId } from '@sim/utils/id'

const MAX_FRAME_BYTES = 16 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (result: ComputerUseResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface ComputerUseNativeClient {
  request(method: string, params: Record<string, unknown>): Promise<ComputerUseResult>
  stop(): void
}

/** A private stdio channel avoids an unauthenticated local control port. */
export class NativeComputerUseClient implements ComputerUseNativeClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, PendingRequest>()
  private buffer = Buffer.alloc(0)
  private stopping: Promise<void> = Promise.resolve()
  private generation = 0

  constructor(
    private readonly executable: string,
    private readonly onReset: () => void
  ) {}

  async request(method: string, params: Record<string, unknown>): Promise<ComputerUseResult> {
    const generation = this.generation
    await this.stopping
    if (generation !== this.generation) throw new Error('Computer Use stopped.')
    if (this.pending.size >= 16) return Promise.reject(new Error('Computer Use is busy.'))
    const child = this.start()
    const id = generateId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stopWithError(new Error('Computer Use timed out; inspect the app before retrying.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error && this.child === child)
          this.stopWithError(new Error('Computer Use helper disconnected.'))
      })
    })
  }

  stop(): void {
    this.stopWithError(new Error('Computer Use stopped. Observe the app again before continuing.'))
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = spawn(this.executable, [], {
      stdio: 'pipe',
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    })
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      this.buffer = Buffer.concat([this.buffer, chunk])
      if (this.buffer.length > MAX_FRAME_BYTES) {
        this.stopWithError(new Error('Computer Use returned an oversized response.'))
        return
      }
      let newline = this.buffer.indexOf(10)
      while (newline >= 0) {
        const line = this.buffer.subarray(0, newline).toString('utf8')
        this.buffer = this.buffer.subarray(newline + 1)
        try {
          const reply = ComputerUseNativeReplySchema.parse(JSON.parse(line))
          const pending = this.pending.get(reply.id)
          if (pending) {
            clearTimeout(pending.timer)
            this.pending.delete(reply.id)
            if ('error' in reply) pending.reject(new ComputerUseError(reply.error))
            else pending.resolve(reply.result)
          }
        } catch {
          this.stopWithError(new Error('Computer Use returned an invalid response.'))
          return
        }
        newline = this.buffer.indexOf(10)
      }
    })
    /** Native diagnostics must never copy app contents into application logs. */
    child.stderr.resume()
    child.stdin.on('error', () => {
      if (this.child === child) this.stopWithError(new Error('Computer Use helper disconnected.'))
    })
    child.on('error', () => {
      if (this.child === child)
        this.stopWithError(new Error('Computer Use helper could not start.'))
    })
    child.on('exit', () => {
      if (this.child === child) this.stopWithError(new Error('Computer Use helper exited.'))
    })
    return child
  }

  private stopWithError(error: Error): void {
    this.generation += 1
    const child = this.child
    this.child = null
    this.buffer = Buffer.alloc(0)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.onReset()
    if (child) {
      this.stopping = new Promise((resolve) => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
          resolve()
          return
        }
        const force = setTimeout(() => child.kill('SIGKILL'), 1_000)
        force.unref()
        child.once('exit', () => {
          clearTimeout(force)
          resolve()
        })
        child.once('error', () => {
          clearTimeout(force)
          resolve()
        })
        child.stdin.end()
        child.kill('SIGTERM')
      })
    }
  }
}
