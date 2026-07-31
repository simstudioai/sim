import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { CredentialVault } from '@/main/browser-credentials/vault'

/**
 * A stand-in for Electron `safeStorage`. It is deliberately reversible so the
 * vault's own logic can be exercised; the tests that matter for secrecy assert
 * that the vault always routes through this provider and refuses to write
 * anything when it reports itself unavailable.
 */
function encryption(available = true) {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^sealed:/, '')),
  }
}

let directory: string
let vaultPath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-vault-test-'))
  vaultPath = join(directory, 'browser-credentials.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const CANDIDATES = [
  { origin: 'https://example.com/login', username: 'ada', password: 'hunter2' },
  { origin: 'https://other.test', username: 'grace', password: 'correct-horse' },
]

describe('CredentialVault', () => {
  it('stores and lists credentials without their passwords', async () => {
    const vault = new CredentialVault(vaultPath, encryption())

    await expect(vault.importCredentials(CANDIDATES, 'keep-existing')).resolves.toEqual({
      added: 2,
      updated: 0,
      skipped: 0,
    })

    const listed = await vault.list()
    expect(listed).toHaveLength(2)
    expect(listed[0]).toMatchObject({ origin: 'https://example.com', username: 'ada' })
    expect(listed.every((entry) => !('password' in entry))).toBe(true)
  })

  it('writes only through the encryption provider, and never plaintext', async () => {
    const provider = encryption()
    const vault = new CredentialVault(vaultPath, provider)

    await vault.importCredentials(CANDIDATES, 'keep-existing')

    expect(provider.encryptString).toHaveBeenCalled()
    const onDisk = await readFile(vaultPath, 'utf8')
    expect(onDisk).not.toContain('hunter2')
    expect(onDisk).not.toContain('correct-horse')
    expect(JSON.parse(onDisk)).toMatchObject({ version: 1, ciphertext: expect.any(String) })
  })

  it('writes the vault file owner-only', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')

    expect((await stat(vaultPath)).mode & 0o077).toBe(0)
  })

  it('refuses to store anything when secure storage is unavailable', async () => {
    // No plaintext fallback: a password file Sim cannot encrypt is worse than
    // a feature the user does not get.
    const provider = encryption(false)
    const vault = new CredentialVault(vaultPath, provider)

    expect(vault.isAvailable()).toBe(false)
    await expect(vault.importCredentials(CANDIDATES, 'keep-existing')).resolves.toEqual({
      added: 0,
      updated: 0,
      skipped: 2,
    })
    expect(provider.encryptString).not.toHaveBeenCalled()
    await expect(readFile(vaultPath, 'utf8')).rejects.toThrow()
  })

  it('treats exact origin plus username as one credential', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')

    // A different subdomain and a different username are both new credentials.
    await expect(
      vault.importCredentials(
        [
          { origin: 'https://sub.example.com', username: 'ada', password: 'x' },
          { origin: 'https://example.com', username: 'grace', password: 'y' },
        ],
        'keep-existing'
      )
    ).resolves.toMatchObject({ added: 2 })
  })

  it('keeps the existing password on conflict by default', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')

    await expect(
      vault.importCredentials(
        [{ origin: 'https://example.com', username: 'ada', password: 'changed' }],
        'keep-existing'
      )
    ).resolves.toEqual({ added: 0, updated: 0, skipped: 1 })

    const stored = await vault.readForFill(
      (await vault.list()).find((entry) => entry.username === 'ada')?.id ?? '',
      'https://example.com'
    )
    expect(stored?.password).toBe('hunter2')
  })

  it('replaces the password on conflict when asked', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')

    await expect(
      vault.importCredentials(
        [{ origin: 'https://example.com', username: 'ada', password: 'changed' }],
        'replace'
      )
    ).resolves.toEqual({ added: 0, updated: 1, skipped: 0 })

    const id = (await vault.list()).find((entry) => entry.username === 'ada')?.id ?? ''
    expect((await vault.readForFill(id, 'https://example.com'))?.password).toBe('changed')
  })

  it('skips candidates with no usable origin or an empty password', async () => {
    const vault = new CredentialVault(vaultPath, encryption())

    await expect(
      vault.importCredentials(
        [
          { origin: 'android://token@com.example/', username: 'a', password: 'p' },
          { origin: 'https://example.com', username: 'b', password: '' },
        ],
        'keep-existing'
      )
    ).resolves.toEqual({ added: 0, updated: 0, skipped: 2 })
  })

  it('only returns a password for the origin it belongs to', async () => {
    // The last guard before plaintext exists: an id alone is not enough.
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')
    const id = (await vault.list()).find((entry) => entry.username === 'ada')?.id ?? ''

    expect(await vault.readForFill(id, 'https://example.com')).toMatchObject({
      password: 'hunter2',
    })
    expect(await vault.readForFill(id, 'https://evil.test')).toBeNull()
    expect(await vault.readForFill('no-such-id', 'https://example.com')).toBeNull()
  })

  it('lists matches for one exact origin only', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')

    expect(await vault.listForOrigin('https://example.com/login')).toHaveLength(1)
    expect(await vault.listForOrigin('https://sub.example.com')).toHaveLength(0)
    expect(await vault.listForOrigin('not-a-url')).toHaveLength(0)
  })

  it('forgets one credential', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')
    const id = (await vault.list())[0].id

    await expect(vault.delete(id)).resolves.toBe(true)
    await expect(vault.delete(id)).resolves.toBe(false)
    expect(await vault.list()).toHaveLength(1)
  })

  it('destroys everything on clear', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')

    await vault.clear()

    expect(await vault.list()).toEqual([])
    await expect(readFile(vaultPath, 'utf8')).rejects.toThrow()
    // Clearing an already-empty vault is not an error.
    await expect(vault.clear()).resolves.toBeUndefined()
  })

  it('reads a corrupt or undecryptable vault as empty instead of throwing', async () => {
    const provider = encryption()
    provider.decryptString = vi.fn(() => {
      throw new Error('wrong key')
    })
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')

    const brokenVault = new CredentialVault(vaultPath, provider)
    await expect(brokenVault.list()).resolves.toEqual([])
  })
})
