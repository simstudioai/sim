import { readFileSync, unlinkSync } from 'node:fs'
import { writeJsonFileAtomicallySync } from '@/main/atomic-json-file'
import { canonicalOrigin, validateOriginInput } from '@/main/config'

const RECOVERY_MARKER_VERSION = 2
export type AccountDataTeardownKind = 'account' | 'deployment'

interface AccountDataRecoveryMarker {
  kind: AccountDataTeardownKind
  origin: string | null
}

let generation = 0
let teardownRequired = false
let teardownKind: AccountDataTeardownKind | null = null
let teardownOrigin: string | null = null
let recoveryMarkerPath: string | null = null
let durableTeardownKind: AccountDataTeardownKind | null = null
let durableTeardownOrigin: string | null = null
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
  const marker = filePath ? readRecoveryMarker(filePath) : null
  const recoveryRequired = marker !== null
  if (recoveryRequired && !teardownRequired) {
    advanceAccountDataGeneration()
  }
  teardownRequired = recoveryRequired
  teardownKind = marker?.kind ?? null
  teardownOrigin = marker?.origin ?? null
  durableTeardownKind = marker?.kind ?? null
  durableTeardownOrigin = marker?.origin ?? null
  return recoveryRequired
}

export function invalidateAccountDataOperations(): void {
  advanceAccountDataGeneration()
  teardownRequired = true
}

/** Persists recovery intent before invalidating account-data work. */
export function beginAccountDataTeardown(kind: AccountDataTeardownKind, origin: string): boolean {
  const validated = validateOriginInput(origin)
  if (!validated.ok) return false
  const targetOrigin = canonicalOrigin(validated.origin)
  if (teardownRequired && teardownOrigin !== targetOrigin) return false
  const effectiveKind = kind === 'account' || teardownKind === 'account' ? 'account' : 'deployment'
  if (!persistAccountDataRecoveryMarker(effectiveKind, targetOrigin)) return false
  const wasRequired = teardownRequired
  teardownKind = effectiveKind
  teardownOrigin = targetOrigin
  teardownRequired = true
  if (!wasRequired) advanceAccountDataGeneration()
  return true
}

export function isAccountDataTeardownRequired(): boolean {
  return teardownRequired
}

export function getAccountDataTeardownKind(): AccountDataTeardownKind | null {
  return teardownKind
}

export function getAccountDataTeardownOrigin(): string | null {
  return teardownOrigin
}

/** Retries marker persistence so shutdown cannot lose an incomplete teardown. */
export function prepareAccountDataTeardownForQuit(): boolean {
  return (
    !teardownRequired ||
    (teardownKind !== null &&
      teardownOrigin !== null &&
      persistAccountDataRecoveryMarker(teardownKind, teardownOrigin))
  )
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
  durableTeardownOrigin = null
  teardownRequired = false
  teardownKind = null
  teardownOrigin = null
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

function persistAccountDataRecoveryMarker(kind: AccountDataTeardownKind, origin: string): boolean {
  if (
    durableTeardownOrigin === origin &&
    (durableTeardownKind === 'account' ||
      (durableTeardownKind === 'deployment' && kind === 'deployment'))
  ) {
    return true
  }
  if (!recoveryMarkerPath) return false
  try {
    writeJsonFileAtomicallySync(recoveryMarkerPath, {
      version: RECOVERY_MARKER_VERSION,
      kind,
      origin,
    })
    durableTeardownKind = kind
    durableTeardownOrigin = origin
    return true
  } catch {
    return false
  }
}

function readRecoveryMarker(filePath: string): AccountDataRecoveryMarker | null {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? null
      : { kind: 'account', origin: null }
  }

  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; origin?: unknown; version?: unknown }
    if (
      parsed.version !== RECOVERY_MARKER_VERSION ||
      (parsed.kind !== 'account' && parsed.kind !== 'deployment') ||
      typeof parsed.origin !== 'string'
    ) {
      return { kind: 'account', origin: null }
    }
    const validated = validateOriginInput(parsed.origin)
    if (!validated.ok || canonicalOrigin(validated.origin) !== parsed.origin) {
      return { kind: 'account', origin: null }
    }
    return { kind: parsed.kind, origin: parsed.origin }
  } catch {
    return { kind: 'account', origin: null }
  }
}
