import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'

export interface CommandOptions {
  name: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  logsDirectory: string
}

export interface ManagedProcess {
  name: string
  child: ChildProcess
  logPath: string
  stop(): Promise<void>
}

const activeProcesses = new Set<ManagedProcess>()

export function spawnManagedProcess(options: CommandOptions): ManagedProcess {
  mkdirSync(options.logsDirectory, { recursive: true })
  const logPath = path.join(options.logsDirectory, `${options.name}.log`)
  const logFd = openSync(logPath, 'a')
  const child: ChildProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ['ignore', logFd, logFd],
  })
  const managed: ManagedProcess = {
    name: options.name,
    child,
    logPath,
    stop: () => stopProcess(child),
  }
  activeProcesses.add(managed)
  child.once('exit', () => {
    activeProcesses.delete(managed)
    closeSync(logFd)
  })
  return managed
}

export async function runCommand(options: CommandOptions): Promise<void> {
  const managed = spawnManagedProcess(options)
  const exitCode = await waitForExit(managed.child)
  if (exitCode !== 0) {
    throw new Error(`${options.name} exited with code ${exitCode}. See ${managed.logPath}`)
  }
}

export async function stopProcesses(processes: ManagedProcess[]): Promise<void> {
  await Promise.allSettled([...processes].reverse().map((process) => process.stop()))
}

export async function stopAllManagedProcesses(): Promise<void> {
  await stopProcesses([...activeProcesses])
}

export function stopAllManagedProcessesSync(
  termTimeoutMs = 5_000,
  killTimeoutMs = 2_000
): number[] {
  const managedProcesses = [...activeProcesses]
  for (const managed of managedProcesses) sendSignal(managed.child, 'SIGTERM')

  const deadline = Date.now() + termTimeoutMs
  while (Date.now() < deadline && managedProcesses.some(({ child }) => isProcessRunning(child))) {
    sleepSync(50)
  }

  for (const { child } of managedProcesses) {
    if (isProcessRunning(child)) sendSignal(child, 'SIGKILL')
  }

  const killDeadline = Date.now() + killTimeoutMs
  while (
    Date.now() < killDeadline &&
    managedProcesses.some(({ child }) => isProcessRunning(child))
  ) {
    sleepSync(25)
  }

  return managedProcesses.flatMap(({ child }) =>
    child.pid && isProcessRunning(child) ? [child.pid] : []
  )
}

export async function waitForManagedProcessReady(
  process: ManagedProcess,
  readiness: Promise<void>
): Promise<void> {
  if (process.child.exitCode !== null || process.child.signalCode !== null) {
    throw new Error(`${process.name} exited before readiness. See ${process.logPath}`)
  }

  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  const exited = new Promise<never>((_, reject) => {
    onExit = (code, signal) => {
      reject(
        new Error(
          `${process.name} exited before readiness with ${code ?? signal ?? 'unknown status'}. See ${process.logPath}`
        )
      )
    }
    process.child.once('exit', onExit)
  })

  try {
    await Promise.race([readiness, exited])
  } finally {
    if (onExit) process.child.off('exit', onExit)
  }
}

export async function assertPortAvailable(port: number, host = '127.0.0.1'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      reject(new Error(`E2E requires ${host}:${port} to be free: ${String(error)}`))
    })
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  sendSignal(child, 'SIGTERM')

  const stopped = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (stopped) return

  sendSignal(child, 'SIGKILL')
  await waitForExit(child)
}

function sendSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  try {
    child.kill(signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/**
 * Managed commands currently run their server/build work in the direct child.
 * If a future command introduces durable grandchildren, process-tree cleanup
 * should be added alongside that command rather than implied here.
 */
function isProcessRunning(child: ChildProcess): boolean {
  if (!child.pid) return false
  try {
    process.kill(child.pid, 0)
    if (process.platform !== 'win32') {
      const status = spawnSync('ps', ['-o', 'stat=', '-p', String(child.pid)], {
        encoding: 'utf8',
        env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
      })
      if (status.status !== 0 || status.stdout.trim().startsWith('Z')) return false
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

function sleepSync(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  Atomics.wait(signal, 0, 0, milliseconds)
}
