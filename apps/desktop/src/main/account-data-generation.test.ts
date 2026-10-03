import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginAccountDataTeardown,
  captureAccountDataGeneration,
  completeAccountDataTeardown,
  completeDeploymentScopedTeardown,
  getAccountDataTeardownKind,
  getAccountDataTeardownOrigin,
  initializeAccountDataRecovery,
  invalidateAccountDataOperations,
  isAccountDataTeardownRequired,
  retryAccountDataTeardown,
  runAccountDataMutation,
  waitForAccountDataMutations,
} from '@/main/account-data-generation'

const ORIGIN = 'https://sim.example.com'

describe('account data generation', () => {
  let directory: string
  let markerPath: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sim-account-recovery-'))
    markerPath = join(directory, 'teardown-required.json')
    initializeAccountDataRecovery(markerPath)
  })

  afterEach(async () => {
    completeAccountDataTeardown()
    initializeAccountDataRecovery(null)
    await rm(directory, { recursive: true, force: true })
  })

  it('blocks account-data mutations and persists teardown intent', () => {
    expect(beginAccountDataTeardown('account', ORIGIN)).toBe(true)

    expect(existsSync(markerPath)).toBe(true)
    expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toEqual({
      version: 2,
      kind: 'account',
      origin: ORIGIN,
    })
    expect(isAccountDataTeardownRequired()).toBe(true)
  })

  it('does not erase data when the recovery marker cannot be written', async () => {
    const blockedParent = join(directory, 'blocked')
    markerPath = join(blockedParent, 'teardown-required.json')
    initializeAccountDataRecovery(markerPath)
    writeFileSync(blockedParent, 'not a directory')
    const generation = captureAccountDataGeneration()
    expect(beginAccountDataTeardown('account', ORIGIN)).toBe(false)
    const firstClear = vi.fn(async () => {})
    const secondClear = vi.fn(async () => {})

    await expect(
      retryAccountDataTeardown([
        { label: 'browser profile', clear: firstClear },
        { label: 'local filesystem grants', clear: secondClear },
      ])
    ).resolves.toEqual([])

    expect(firstClear).not.toHaveBeenCalled()
    expect(secondClear).not.toHaveBeenCalled()
    expect(isAccountDataTeardownRequired()).toBe(false)
    await expect(runAccountDataMutation(generation, async () => 'ok')).resolves.toBe('ok')
  })

  it('restores the fail-closed state from a marker and clears it only on completion', () => {
    writeFileSync(markerPath, JSON.stringify({ version: 2, kind: 'deployment', origin: ORIGIN }))

    expect(initializeAccountDataRecovery(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)
    expect(getAccountDataTeardownKind()).toBe('deployment')
    expect(getAccountDataTeardownOrigin()).toBe(ORIGIN)

    completeAccountDataTeardown()
    expect(existsSync(markerPath)).toBe(false)
    expect(isAccountDataTeardownRequired()).toBe(false)
    expect(getAccountDataTeardownKind()).toBeNull()
  })

  it('never downgrades or clears an account recovery marker for a server switch', () => {
    beginAccountDataTeardown('account', ORIGIN)
    beginAccountDataTeardown('deployment', ORIGIN)
    const commit = vi.fn(() => true)

    expect(getAccountDataTeardownKind()).toBe('account')
    expect(completeDeploymentScopedTeardown(commit)).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(existsSync(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)
  })

  it('does not retarget an active teardown to a different origin', () => {
    beginAccountDataTeardown('deployment', ORIGIN)

    expect(beginAccountDataTeardown('account', 'https://other.example.com')).toBe(false)
    expect(getAccountDataTeardownKind()).toBe('deployment')
    expect(getAccountDataTeardownOrigin()).toBe(ORIGIN)
    expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toEqual({
      version: 2,
      kind: 'deployment',
      origin: ORIGIN,
    })
  })

  it('waits for an admitted commit before teardown can clear its store', async () => {
    let releaseMutation: (() => void) | undefined
    const mutation = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    const generation = captureAccountDataGeneration()
    const pendingMutation = runAccountDataMutation(generation, () => mutation)

    invalidateAccountDataOperations()
    const settled = vi.fn()
    const pendingWait = waitForAccountDataMutations().then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    releaseMutation?.()
    await pendingMutation
    await pendingWait
    expect(settled).toHaveBeenCalledOnce()
  })

  it('rejects a stale commit after teardown begins', async () => {
    const generation = captureAccountDataGeneration()
    invalidateAccountDataOperations()
    const mutation = vi.fn(async () => {})

    await expect(runAccountDataMutation(generation, mutation)).rejects.toThrow(
      'expired during teardown'
    )
    expect(mutation).not.toHaveBeenCalled()
  })
})
