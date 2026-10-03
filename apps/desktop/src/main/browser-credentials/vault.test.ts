import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  it('retains imported logins when the vault is reopened and does not duplicate a re-import', async () => {
    const original = new CredentialVault(vaultPath, encryption())
    await original.importCredentials(CANDIDATES, 'replace')
    const metadata = await original.list()

    const reopened = new CredentialVault(vaultPath, encryption())
    expect(await reopened.list()).toEqual(metadata)
    expect(await reopened.readForFill(metadata[0].id, metadata[0].origin)).toEqual({
      username: 'ada',
      password: 'hunter2',
    })
    expect(await reopened.importCredentials(CANDIDATES, 'replace')).toEqual({
      added: 0,
      updated: 0,
      skipped: 2,
    })
    expect(await reopened.list()).toEqual(metadata)
  })

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

  it('serializes overlapping imports so every write sees the previous result', async () => {
    const vault = new CredentialVault(vaultPath, encryption())
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      origin: `https://site-${index}.test`,
      username: `user-${index}`,
      password: `password-${index}`,
    }))

    await Promise.all(
      candidates.map((candidate) => vault.importCredentials([candidate], 'keep-existing'))
    )

    expect(await vault.list()).toHaveLength(candidates.length)
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

  it('preserves an undecryptable vault until clear explicitly resets it', async () => {
    const provider = encryption()
    provider.decryptString.mockImplementationOnce(() => {
      throw new Error('wrong key')
    })
    const vault = new CredentialVault(vaultPath, encryption())
    await vault.importCredentials(CANDIDATES, 'keep-existing')
    const original = await readFile(vaultPath, 'utf8')

    const brokenVault = new CredentialVault(vaultPath, provider)
    await expect(brokenVault.list()).resolves.toEqual([])
    expect(brokenVault.isAvailable()).toBe(false)
    await expect(brokenVault.importCredentials(CANDIDATES, 'replace')).resolves.toEqual({
      added: 0,
      updated: 0,
      skipped: 2,
    })
    await expect(readFile(vaultPath, 'utf8')).resolves.toBe(original)

    await brokenVault.clear()
    expect(brokenVault.isAvailable()).toBe(true)
    await expect(brokenVault.importCredentials([CANDIDATES[0]], 'keep-existing')).resolves.toEqual({
      added: 1,
      updated: 0,
      skipped: 0,
    })
    await expect(brokenVault.list()).resolves.toHaveLength(1)
  })

  it('blocks a stored credential with fields outside the persistence contract', async () => {
    const provider = encryption()
    const payload = [
      {
        id: 'credential-1',
        origin: 'https://example.com',
        username: 'ada',
        password: 'secret',
        icon: { unexpected: true },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'chrome',
      },
    ]
    const original = JSON.stringify({
      version: 1,
      ciphertext: provider.encryptString(JSON.stringify(payload)).toString('base64'),
    })
    await writeFile(vaultPath, original)
    const vault = new CredentialVault(vaultPath, provider)

    await expect(vault.list()).resolves.toEqual([])
    await expect(vault.importCredentials(CANDIDATES, 'replace')).resolves.toMatchObject({
      added: 0,
    })
    await expect(readFile(vaultPath, 'utf8')).resolves.toBe(original)
  })
})
