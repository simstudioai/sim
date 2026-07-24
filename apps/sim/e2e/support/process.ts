import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { isProcessGroupAlive } from './signal-cleanup'

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
  completion: Promise<ProcessCompletion>
  logPath: string
  stop(): Promise<void>
}

interface ProcessCompletion {
  code: number | null
  signal: NodeJS.Signals | null
  error?: Error
}

const activeProcesses = new Set<ManagedProcess>()
let processGroupObserver: ((processGroupIds: number[]) => void) | null = null

export function setManagedProcessGroupObserver(
  observer: ((processGroupIds: number[]) => void) | null
): void {
  processGroupObserver = observer
  notifyProcessGroupObserver()
}

export function spawnManagedProcess(options: CommandOptions): ManagedProcess {
  mkdirSync(options.logsDirectory, { recursive: true })
  const logPath = path.join(options.logsDirectory, `${options.name}.log`)
  const logFd = openSync(logPath, 'a')
  const child: ChildProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    detached: process.platform !== 'win32',
    env: options.env as NodeJS.ProcessEnv,
    stdio: ['ignore', logFd, logFd],
  })
  let resolveCompletion!: (completion: ProcessCompletion) => void
  const completion = new Promise<ProcessCompletion>((resolve) => {
    resolveCompletion = resolve
  })
  let finalized = false
  const managed: ManagedProcess = {
    name: options.name,
    child,
    completion,
    logPath,
    stop: () => stopProcess(managed),
  }
  const finalize = (result: ProcessCompletion): void => {
    if (finalized) return
    finalized = true
    if (!child.pid || !isProcessGroupAlive(child.pid)) {
      activeProcesses.delete(managed)
      notifyProcessGroupObserver()
    }
    closeSync(logFd)
    resolveCompletion(result)
  }
  activeProcesses.add(managed)
  notifyProcessGroupObserver()
  child.once('error', (error) => finalize({ code: null, signal: null, error }))
  child.once('exit', (code, signal) => finalize({ code, signal }))
  return managed
}

export async function runCommand(options: CommandOptions): Promise<void> {
  const managed = spawnManagedProcess(options)
  const result = await managed.completion
  await managed.stop()
  if (result.error) {
    throw new Error(`${options.name} failed to spawn. See ${managed.logPath}`, {
      cause: result.error,
    })
  }
  if (result.code !== 0) {
    throw new Error(
      `${options.name} exited with ${result.code ?? result.signal ?? 'unknown status'}. See ${managed.logPath}`
    )
  }
}

export async function stopProcesses(processes: ManagedProcess[]): Promise<void> {
  const results = await Promise.allSettled(
    [...processes].reverse().map((process) => process.stop())
  )
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to stop one or more managed E2E processes')
  }
}

export async function stopAllManagedProcesses(): Promise<void> {
  await stopProcesses([...activeProcesses])
}

export function getActiveManagedProcessGroupIds(): number[] {
  return [...new Set([...activeProcesses].flatMap(({ child }) => (child.pid ? [child.pid] : [])))]
}

function notifyProcessGroupObserver(): void {
  processGroupObserver?.(getActiveManagedProcessGroupIds())
}

export async function waitForManagedProcessReady(
  process: ManagedProcess,
  readiness: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  if (process.child.exitCode !== null || process.child.signalCode !== null) {
    throw new Error(`${process.name} exited before readiness. See ${process.logPath}`)
  }

  const controller = new AbortController()
  let ready = false
  const exited = process.completion.then((result) => {
    if (ready) return
    throw new Error(
      `${process.name} exited before readiness with ${result.error?.message ?? result.code ?? result.signal ?? 'unknown status'}. See ${process.logPath}`
    )
  })
  const becameReady = readiness(controller.signal).then(() => {
    ready = true
  })

  try {
    await Promise.race([becameReady, exited])
  } finally {
    controller.abort(new Error(`${process.name} readiness polling cancelled`))
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

async function stopProcess(managed: ManagedProcess): Promise<void> {
  const { child } = managed
  if (!child.pid) {
    await managed.completion
    activeProcesses.delete(managed)
    notifyProcessGroupObserver()
    return
  }
  if (!isProcessGroupAlive(child.pid)) {
    activeProcesses.delete(managed)
    notifyProcessGroupObserver()
    return
  }
  const processIds = [child.pid]
  sendSignalToPids(processIds, 'SIGTERM')

  if (await waitForProcessGroupExit(child.pid, 5_000)) {
    activeProcesses.delete(managed)
    notifyProcessGroupObserver()
    return
  }

  sendSignalToPids(processIds, 'SIGKILL')
  if (!(await waitForProcessGroupExit(child.pid, 2_000))) {
    throw new Error(`Managed process group ${managed.name} survived SIGKILL`)
  }
  activeProcesses.delete(managed)
  notifyProcessGroupObserver()
}

async function waitForProcessGroupExit(groupId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(groupId)) return true
    await sleep(50)
  }
  return !isProcessGroupAlive(groupId)
}

function sendSignalToPids(processIds: number[], signal: NodeJS.Signals): void {
  for (const processId of processIds) {
    try {
      if (process.platform !== 'win32') process.kill(-processId, signal)
      else process.kill(processId, signal)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ESRCH') continue
      if (code === 'EPERM' && process.platform !== 'win32') {
        try {
          process.kill(processId, signal)
        } catch (fallbackError) {
          if ((fallbackError as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw fallbackError
          }
        }
        continue
      }
      throw error
    }
  }
}
