import { mkdtemp, readFile, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { createEncryptedLocalFilesystemGrantStore } from '@/main/local-filesystem-grant-store'

function testEncryption(available = true) {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((value: string) => Buffer.from(`protected:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^protected:/, '')),
  }
}

describe('createEncryptedLocalFilesystemGrantStore', () => {
  it('encrypts grants at rest and restores them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const encryption = testEncryption()
    const store = createEncryptedLocalFilesystemGrantStore(filePath, encryption)
    const grants = [
      {
        id: 'grant-1',
        name: 'project',
        rootPath: '/Users/example/private-project',
        bookmark: 'security-scoped-bookmark',
      },
    ]

    await expect(store.save(grants)).resolves.toBe(true)

    const raw = await readFile(filePath, 'utf8')
    expect(raw).not.toContain(grants[0].rootPath)
    expect(raw).not.toContain(grants[0].bookmark)
    expect(encryption.encryptString).toHaveBeenCalledOnce()
    await expect(store.load()).resolves.toEqual(grants)

    await store.clear()
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not let an earlier save recreate the store after a later clear', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const store = createEncryptedLocalFilesystemGrantStore(filePath, testEncryption())
    const grants = [{ id: 'grant-1', name: 'project', rootPath: '/private/project' }]

    await store.load()
    const saving = store.save(grants)
    const clearing = store.clear()
    await Promise.all([saving, clearing])

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applies concurrent mutations in invocation order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const store = createEncryptedLocalFilesystemGrantStore(filePath, testEncryption())
    const first = [{ id: 'grant-1', name: 'first', rootPath: '/private/first' }]
    const second = [{ id: 'grant-2', name: 'second', rootPath: '/private/second' }]

    await Promise.all([store.save(first), store.clear(), store.save(second)])

    await expect(store.load()).resolves.toEqual(second)
  })

  it('does not write a plaintext fallback when OS encryption is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const store = createEncryptedLocalFilesystemGrantStore(filePath, testEncryption(false))

    await expect(
      store.save([{ id: 'grant-1', name: 'project', rootPath: '/private/project' }])
    ).resolves.toBe(false)
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves an invalid existing store until an explicit clear', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const original = '{not valid json'
    await writeFile(filePath, original)
    const store = createEncryptedLocalFilesystemGrantStore(filePath, testEncryption())
    const grants = [{ id: 'grant-1', name: 'project', rootPath: '/private/project' }]

    await expect(store.load()).resolves.toEqual([])
    await expect(store.save(grants)).resolves.toBe(false)
    await expect(readFile(filePath, 'utf8')).resolves.toBe(original)

    await store.clear()
    await expect(store.save(grants)).resolves.toBe(true)
    await expect(store.load()).resolves.toEqual(grants)
  })

  it('does not replace a store written by a foreign version', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const original = JSON.stringify({ version: 99, ciphertext: 'future' })
    await writeFile(filePath, original)
    const store = createEncryptedLocalFilesystemGrantStore(filePath, testEncryption())

    await expect(store.save([])).resolves.toBe(false)
    await expect(readFile(filePath, 'utf8')).resolves.toBe(original)
  })

  it('preserves an oversized grant store until explicit clear', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    await writeFile(filePath, '')
    await truncate(filePath, 4 * 1024 * 1024 + 1)
    const store = createEncryptedLocalFilesystemGrantStore(filePath, testEncryption())

    await expect(store.load()).resolves.toEqual([])
    await expect(
      store.save([{ id: 'grant-1', name: 'project', rootPath: '/private/project' }])
    ).resolves.toBe(false)
    expect((await stat(filePath)).size).toBe(4 * 1024 * 1024 + 1)

    await store.clear()
    await expect(
      store.save([{ id: 'grant-1', name: 'project', rootPath: '/private/project' }])
    ).resolves.toBe(true)
  })

  it('blocks stored grants with fields outside the persistence contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const encryption = testEncryption()
    const payload = [{ id: 'grant-1', name: 'project', rootPath: `/${'x'.repeat(4_096)}` }]
    const original = JSON.stringify({
      version: 1,
      ciphertext: encryption.encryptString(JSON.stringify(payload)).toString('base64'),
    })
    await writeFile(filePath, original)
    const store = createEncryptedLocalFilesystemGrantStore(filePath, encryption)

    await expect(store.load()).resolves.toEqual([])
    await expect(store.save([])).resolves.toBe(false)
    await expect(readFile(filePath, 'utf8')).resolves.toBe(original)
  })
})
