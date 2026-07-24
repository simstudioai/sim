import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { E2E_CACHE_DIR } from './paths'
import { isProcessGroupAlive } from './signal-cleanup'

const OWNER_FILE = 'owner.json'
const ACQUISITION_GRACE_MS = 2_000
const ACQUISITION_RETRIES = 10
const ACQUISITION_RETRY_MS = 10

interface RunLockDescriptor {
  pid: number
  token: string
  startedAt: string
  processStartIdentity: string | null
  processGroupIds: number[]
  processGroupStartIdentities: Record<string, string | null>
  retainedFailure?: string
}

export interface E2eRunLock {
  path: string
  token: string
  setProcessGroupIds(processGroupIds: number[]): void
  transfer(pid: number): boolean
  retain(reason: string): void
  release(): void
}

export function acquireE2eRunLock(
  lockPath = path.join(E2E_CACHE_DIR, 'orchestrator.lock')
): E2eRunLock {
  mkdirSync(path.dirname(lockPath), { recursive: true })
  const descriptor: RunLockDescriptor = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
    processStartIdentity: readProcessStartIdentity(process.pid),
    processGroupIds: [],
    processGroupStartIdentities: {},
  }

  for (let attempt = 0; attempt < ACQUISITION_RETRIES; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      writeDescriptor(lockPath, descriptor)
      return {
        path: lockPath,
        token: descriptor.token,
        setProcessGroupIds(processGroupIds: number[]): void {
          const current = readDescriptor(lockPath)
          if (current?.token !== descriptor.token || current.pid !== descriptor.pid) return
          const normalized = [...new Set(processGroupIds)].filter(
            (processGroupId) => Number.isInteger(processGroupId) && processGroupId > 0
          )
          writeDescriptor(lockPath, {
            ...current,
            processGroupIds: normalized,
            processGroupStartIdentities: Object.fromEntries(
              normalized.map((processGroupId) => [
                String(processGroupId),
                readProcessStartIdentity(processGroupId),
              ])
            ),
          })
        },
        transfer(pid: number): boolean {
          const current = readDescriptor(lockPath)
          if (current?.token !== descriptor.token || current.pid !== descriptor.pid) return false
          writeDescriptor(lockPath, {
            ...current,
            pid,
            processStartIdentity: readProcessStartIdentity(pid),
          })
          const transferred = readDescriptor(lockPath)
          return transferred?.token === descriptor.token && transferred.pid === pid
        },
        retain(reason: string): void {
          retainE2eRunLock(lockPath, descriptor.token, descriptor.pid, reason)
        },
        release(): void {
          releaseE2eRunLock(lockPath, descriptor.token, descriptor.pid)
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = readDescriptor(lockPath)
      if (existing?.retainedFailure) {
        throw new Error(
          `Previous E2E cleanup failed and retained ${lockPath}: ${existing.retainedFailure}. Remove the lock only after manual cleanup.`
        )
      }
      if (existing && isLockOwnerAlive(existing)) {
        throw new Error(
          `Another E2E orchestrator owns ${lockPath} (PID ${existing.pid}, started ${existing.startedAt})`
        )
      }
      if (!existing && lockAgeMs(lockPath) < ACQUISITION_GRACE_MS) {
        if (attempt === ACQUISITION_RETRIES - 1) {
          throw new Error(`Another E2E orchestrator is acquiring ${lockPath}`)
        }
        sleepSync(ACQUISITION_RETRY_MS)
        continue
      }
      if (existing) terminateStaleProcessGroups(lockPath, existing)
      rmSync(lockPath, { recursive: true, force: true })
    }
  }
  throw new Error(`Unable to acquire E2E orchestrator lock: ${lockPath}`)
}

export function releaseE2eRunLock(lockPath: string, token: string, expectedOwnerPid: number): void {
  if (!existsSync(lockPath)) return
  const current = readDescriptor(lockPath)
  if (current?.token === token && current.pid === expectedOwnerPid) {
    rmSync(lockPath, { recursive: true, force: true })
  }
}

export function retainE2eRunLock(
  lockPath: string,
  token: string,
  expectedOwnerPid: number,
  reason: string
): void {
  const current = readDescriptor(lockPath)
  if (current?.token !== token || current.pid !== expectedOwnerPid) return
  writeDescriptor(lockPath, { ...current, retainedFailure: reason })
}

function readDescriptor(lockPath: string): RunLockDescriptor | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(lockPath, OWNER_FILE), 'utf8')
    ) as Partial<RunLockDescriptor>
    return typeof parsed.pid === 'number' &&
      typeof parsed.token === 'string' &&
      typeof parsed.startedAt === 'string' &&
      (typeof parsed.processStartIdentity === 'string' || parsed.processStartIdentity === null) &&
      (parsed.processGroupIds === undefined ||
        (Array.isArray(parsed.processGroupIds) &&
          parsed.processGroupIds.every(
            (processGroupId) => Number.isInteger(processGroupId) && processGroupId > 0
          ))) &&
      (parsed.processGroupStartIdentities === undefined ||
        (typeof parsed.processGroupStartIdentities === 'object' &&
          parsed.processGroupStartIdentities !== null &&
          Object.values(parsed.processGroupStartIdentities).every(
            (identity) => typeof identity === 'string' || identity === null
          ))) &&
      (parsed.retainedFailure === undefined || typeof parsed.retainedFailure === 'string')
      ? ({
          ...parsed,
          processGroupIds: parsed.processGroupIds ?? [],
          processGroupStartIdentities: parsed.processGroupStartIdentities ?? {},
        } as RunLockDescriptor)
      : null
  } catch {
    return null
  }
}

function writeDescriptor(lockPath: string, descriptor: RunLockDescriptor): void {
  const temporary = path.join(lockPath, `${OWNER_FILE}.tmp-${process.pid}`)
  writeFileSync(temporary, `${JSON.stringify(descriptor)}\n`, { mode: 0o600 })
  renameSync(temporary, path.join(lockPath, OWNER_FILE))
}

function lockAgeMs(lockPath: string): number {
  try {
    return Date.now() - statSync(lockPath).mtimeMs
  } catch {
    return 0
  }
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isLockOwnerAlive(descriptor: RunLockDescriptor): boolean {
  if (!isProcessAlive(descriptor.pid)) return false
  if (!descriptor.processStartIdentity) return true
  return readProcessStartIdentity(descriptor.pid) === descriptor.processStartIdentity
}

function terminateStaleProcessGroups(lockPath: string, descriptor: RunLockDescriptor): void {
  for (const groupId of descriptor.processGroupIds) {
    if (!isProcessGroupAlive(groupId)) continue
    if (isProcessAlive(groupId)) {
      const expectedIdentity = descriptor.processGroupStartIdentities[String(groupId)]
      const actualIdentity = readProcessStartIdentity(groupId)
      if (!expectedIdentity || actualIdentity !== expectedIdentity) {
        throw new Error(
          `Refusing to terminate stale E2E process group ${groupId} from ${lockPath} because its leader identity changed`
        )
      }
    }
    // A process group may outlive its leader, leaving no leader identity to recheck. In that
    // case the still-nonempty group retains its tracked PGID; if that PID is reused, the
    // live-leader identity check above fails closed instead of signaling the new process.
    try {
      if (process.platform !== 'win32') process.kill(-groupId, 'SIGKILL')
      else process.kill(groupId, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw new Error(`Unable to terminate stale E2E process group ${groupId} from ${lockPath}`, {
          cause: error,
        })
      }
    }
  }

  const deadline = Date.now() + 2_000
  while (
    descriptor.processGroupIds.some((groupId) => isProcessGroupAlive(groupId)) &&
    Date.now() < deadline
  ) {
    sleepSync(25)
  }
  const survivors = descriptor.processGroupIds.filter((groupId) => isProcessGroupAlive(groupId))
  if (survivors.length > 0) {
    throw new Error(
      `Stale E2E process groups survived cleanup for ${lockPath}: ${survivors.join(', ')}`
    )
  }
}

function readProcessStartIdentity(pid: number): string | null {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
  })
  if (result.status !== 0) return null
  const identity = result.stdout.trim()
  return identity || null
}
