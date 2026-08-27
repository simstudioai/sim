import { existsSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
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
  initializeAccountDataRecovery,
  invalidateAccountDataOperations,
  isAccountDataTeardownRequired,
  prepareAccountDataTeardownForQuit,
  retryAccountDataTeardown,
  runAccountDataMutation,
  waitForAccountDataMutations,
} from '@/main/account-data-generation'

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
    expect(beginAccountDataTeardown()).toBe(true)

    expect(existsSync(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)
  })

  it('fails closed and retries marker persistence before quit', () => {
    const blockedParent = join(directory, 'blocked')
    markerPath = join(blockedParent, 'teardown-required.json')
    initializeAccountDataRecovery(markerPath)
    writeFileSync(blockedParent, 'not a directory')

    expect(beginAccountDataTeardown()).toBe(false)
    expect(isAccountDataTeardownRequired()).toBe(true)
    expect(prepareAccountDataTeardownForQuit()).toBe(false)

    unlinkSync(blockedParent)
    mkdirSync(blockedParent)
    expect(prepareAccountDataTeardownForQuit()).toBe(true)
    expect(existsSync(markerPath)).toBe(true)
  })

  it('still attempts every erasure when the recovery marker cannot be written', async () => {
    const blockedParent = join(directory, 'blocked')
    markerPath = join(blockedParent, 'teardown-required.json')
    initializeAccountDataRecovery(markerPath)
    writeFileSync(blockedParent, 'not a directory')
    expect(beginAccountDataTeardown()).toBe(false)
    const firstClear = vi.fn(async () => {})
    const secondClear = vi.fn(async () => {})

    await expect(
      retryAccountDataTeardown([
        { label: 'browser profile', clear: firstClear },
        { label: 'local filesystem grants', clear: secondClear },
      ])
    ).resolves.toEqual([])

    expect(firstClear).toHaveBeenCalledOnce()
    expect(secondClear).toHaveBeenCalledOnce()
    expect(isAccountDataTeardownRequired()).toBe(false)
  })

  it('restores the fail-closed state from a marker and clears it only on completion', () => {
    writeFileSync(markerPath, '{"version":1,"kind":"deployment"}')

    expect(initializeAccountDataRecovery(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)
    expect(getAccountDataTeardownKind()).toBe('deployment')

    completeAccountDataTeardown()
    expect(existsSync(markerPath)).toBe(false)
    expect(isAccountDataTeardownRequired()).toBe(false)
    expect(getAccountDataTeardownKind()).toBeNull()
  })

  it('keeps recovery gated until a retry clears every account store', async () => {
    beginAccountDataTeardown()
    const failedClear = vi.fn(async () => {
      throw new Error('keychain unavailable')
    })
    const successfulClear = vi.fn(async () => {})

    await expect(
      retryAccountDataTeardown([
        { label: 'browser profile', clear: failedClear },
        { label: 'local filesystem grants', clear: successfulClear },
      ])
    ).resolves.toEqual(['browser profile'])
    expect(existsSync(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)

    await expect(
      retryAccountDataTeardown([
        { label: 'browser profile', clear: successfulClear },
        { label: 'local filesystem grants', clear: successfulClear },
      ])
    ).resolves.toEqual([])
    expect(existsSync(markerPath)).toBe(false)
    expect(isAccountDataTeardownRequired()).toBe(false)
  })

  it('never downgrades or clears an account recovery marker for a server switch', () => {
    beginAccountDataTeardown('account')
    beginAccountDataTeardown('deployment')
    const commit = vi.fn(() => true)

    expect(getAccountDataTeardownKind()).toBe('account')
    expect(completeDeploymentScopedTeardown(commit)).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect(existsSync(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)
  })

  it('keeps deployment recovery armed when the server configuration commit fails', () => {
    beginAccountDataTeardown('deployment')

    expect(completeDeploymentScopedTeardown(() => false)).toBe(false)
    expect(existsSync(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)
  })

  it('keeps deployment recovery armed when the server configuration commit throws', () => {
    beginAccountDataTeardown('deployment')

    expect(() =>
      completeDeploymentScopedTeardown(() => {
        throw new Error('disk unavailable')
      })
    ).toThrow('disk unavailable')
    expect(existsSync(markerPath)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(true)
  })

  it('reports successful completion of a deployment-scoped teardown', () => {
    beginAccountDataTeardown('deployment')

    expect(completeDeploymentScopedTeardown(() => true)).toBe(true)
    expect(isAccountDataTeardownRequired()).toBe(false)
  })

  it('treats an unknown marker version as the stronger account teardown', () => {
    writeFileSync(markerPath, '{"version":2,"kind":"deployment"}')

    initializeAccountDataRecovery(markerPath)

    expect(getAccountDataTeardownKind()).toBe('account')
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
