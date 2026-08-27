import { readFileSync, unlinkSync } from 'node:fs'
import { writeJsonFileAtomicallySync } from '@/main/atomic-json-file'

const RECOVERY_MARKER_VERSION = 1
export type AccountDataTeardownKind = 'account' | 'deployment'

let generation = 0
let teardownRequired = false
let teardownKind: AccountDataTeardownKind | null = null
let recoveryMarkerPath: string | null = null
let durableTeardownKind: AccountDataTeardownKind | null = null
const activeMutations = new Set<Promise<unknown>>()

export class ExpiredAccountDataOperationError extends Error {
  constructor() {
    super('The account-data operation expired during teardown.')
    this.name = 'ExpiredAccountDataOperationError'
  }
}

export function captureAccountDataGeneration(): number {
  return generation
}

/** Expires work already in progress without changing whether new work is admitted. */
export function advanceAccountDataGeneration(): void {
  generation += 1
}

/** Restores the fail-closed teardown state before account-bearing stores open. */
export function initializeAccountDataRecovery(filePath: string | null): boolean {
  recoveryMarkerPath = filePath
  const recoveredKind = filePath ? readTeardownKind(filePath) : null
  const recoveryRequired = recoveredKind !== null
  if (recoveryRequired && !teardownRequired) {
    advanceAccountDataGeneration()
  }
  teardownRequired = recoveryRequired
  teardownKind = recoveredKind
  durableTeardownKind = recoveredKind
  return recoveryRequired
}

export function invalidateAccountDataOperations(): void {
  advanceAccountDataGeneration()
  teardownRequired = true
}

/** Invalidates account-data work, then best-effort persists recovery intent. */
export function beginAccountDataTeardown(kind: AccountDataTeardownKind = 'account'): boolean {
  const effectiveKind = kind === 'account' || teardownKind === 'account' ? 'account' : 'deployment'
  teardownKind = effectiveKind
  invalidateAccountDataOperations()
  return persistAccountDataRecoveryMarker()
}

export function isAccountDataTeardownRequired(): boolean {
  return teardownRequired
}

export function getAccountDataTeardownKind(): AccountDataTeardownKind | null {
  return teardownKind
}

/** Retries marker persistence so shutdown cannot lose an incomplete teardown. */
export function prepareAccountDataTeardownForQuit(): boolean {
  return !teardownRequired || persistAccountDataRecoveryMarker()
}

export interface AccountDataRecoveryStore {
  label: string
  clear: () => void | Promise<void>
}

/** Retries every erasure from an interrupted teardown without restoring stores first. */
export async function retryAccountDataTeardown(
  stores: readonly AccountDataRecoveryStore[]
): Promise<readonly string[]> {
  if (!teardownRequired) return []
  await waitForAccountDataMutations()
  const outcomes = await Promise.allSettled(
    stores.map(({ clear }) => Promise.resolve().then(clear))
  )
  const failures = outcomes.flatMap((outcome, index) =>
    outcome.status === 'rejected' ? [stores[index].label] : []
  )
  if (failures.length === 0) {
    completeAccountDataTeardown()
  }
  return failures
}

export function isAccountDataGenerationCurrent(capturedGeneration: number): boolean {
  return !teardownRequired && capturedGeneration === generation
}

/** Allows account-data mutations again only after every sensitive store was erased. */
export function completeAccountDataTeardown(): void {
  if (recoveryMarkerPath) {
    try {
      unlinkSync(recoveryMarkerPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    }
  }
  durableTeardownKind = null
  teardownRequired = false
  teardownKind = null
}

/** Commits a server switch and clears its marker without weakening an account wipe. */
export function completeDeploymentScopedTeardown(commit: () => boolean): boolean {
  if (teardownKind !== 'deployment') return false
  if (!commit()) return false
  completeAccountDataTeardown()
  return true
}

/** Tracks a persistent mutation so teardown waits for it to settle. */
export async function runAccountDataMutation<T>(
  capturedGeneration: number,
  operation: () => Promise<T>
): Promise<T> {
  if (!isAccountDataGenerationCurrent(capturedGeneration)) {
    throw new ExpiredAccountDataOperationError()
  }
  const pending = operation()
  activeMutations.add(pending)
  try {
    return await pending
  } finally {
    activeMutations.delete(pending)
  }
}

/** Waits until commits already admitted for the outgoing account have settled. */
export async function waitForAccountDataMutations(): Promise<void> {
  while (activeMutations.size > 0) {
    await Promise.allSettled([...activeMutations])
  }
}

function persistAccountDataRecoveryMarker(): boolean {
  if (!teardownKind) return true
  if (
    durableTeardownKind === 'account' ||
    (durableTeardownKind === 'deployment' && teardownKind === 'deployment')
  ) {
    return true
  }
  if (!recoveryMarkerPath) return false
  try {
    writeJsonFileAtomicallySync(recoveryMarkerPath, {
      version: RECOVERY_MARKER_VERSION,
      kind: teardownKind,
    })
    durableTeardownKind = teardownKind
    return true
  } catch {
    return false
  }
}

function readTeardownKind(filePath: string): AccountDataTeardownKind | null {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'account'
  }

  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; version?: unknown }
    return parsed.version === RECOVERY_MARKER_VERSION && parsed.kind === 'deployment'
      ? 'deployment'
      : 'account'
  } catch {
    return 'account'
  }
}
