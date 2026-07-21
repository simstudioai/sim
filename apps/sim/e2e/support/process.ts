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
    activeProcesses.delete(managed)
    closeSync(logFd)
    resolveCompletion(result)
  }
  activeProcesses.add(managed)
  child.once('error', (error) => finalize({ code: null, signal: null, error }))
  child.once('exit', (code, signal) => finalize({ code, signal }))
  return managed
}

export async function runCommand(options: CommandOptions): Promise<void> {
  const managed = spawnManagedProcess(options)
  const result = await managed.completion
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

export async function waitForManagedProcessReady(
  process: ManagedProcess,
  readiness: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  if (process.child.exitCode !== null || process.child.signalCode !== null) {
    throw new Error(`${process.name} exited before readiness. See ${process.logPath}`)
  }

  const controller = new AbortController()
  const exited = process.completion.then((result) => {
    throw new Error(
      `${process.name} exited before readiness with ${result.error?.message ?? result.code ?? result.signal ?? 'unknown status'}. See ${process.logPath}`
    )
  })

  try {
    await Promise.race([readiness(controller.signal), exited])
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
    return
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  const processIds = [child.pid]
  sendSignalToPids(processIds, 'SIGTERM')

  const stopped = await Promise.race([
    managed.completion.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (stopped) return

  sendSignalToPids(processIds.filter(isPidRunning), 'SIGKILL')
  const killed = await Promise.race([
    managed.completion.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!killed) {
    throw new Error(`Managed process ${managed.name} did not exit after SIGKILL`)
  }
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
        process.kill(processId, signal)
        continue
      }
      throw error
    }
  }
}

function isPidRunning(processId: number): boolean {
  return getRunningPids([processId]).length > 0
}

function getRunningPids(processIds: number[]): number[] {
  if (processIds.length === 0) return []
  if (process.platform === 'win32') {
    return processIds.filter((processId) => {
      try {
        process.kill(processId, 0)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
        throw error
      }
    })
  }

  const status = spawnSync('ps', ['-o', 'pid=,stat=', '-p', processIds.join(',')], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
  })
  if (status.status !== 0 && status.status !== 1) {
    throw new Error(`Unable to inspect managed E2E processes: ${status.stderr}`)
  }
  return status.stdout.split('\n').flatMap((line) => {
    const [pidText, processStatus] = line.trim().split(/\s+/)
    const pid = Number(pidText)
    return Number.isInteger(pid) && !processStatus?.startsWith('Z') ? [pid] : []
  })
}
