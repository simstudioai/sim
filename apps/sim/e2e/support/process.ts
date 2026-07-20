import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
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

export function spawnManagedProcess(options: CommandOptions): ManagedProcess {
  mkdirSync(options.logsDirectory, { recursive: true })
  const logPath = path.join(options.logsDirectory, `${options.name}.log`)
  const logFd = openSync(logPath, 'a')
  const child: ChildProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ['ignore', logFd, logFd],
  })
  child.once('exit', () => closeSync(logFd))

  return {
    name: options.name,
    child,
    logPath,
    stop: () => stopProcess(child),
  }
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

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')

  const stopped = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (stopped) return

  child.kill('SIGKILL')
  await waitForExit(child)
}
