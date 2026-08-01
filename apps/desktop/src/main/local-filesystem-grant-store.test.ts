import { mkdtemp, readFile } from 'node:fs/promises'
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

  it('does not write a plaintext fallback when OS encryption is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-localfs-store-'))
    const filePath = join(directory, 'grants.json')
    const store = createEncryptedLocalFilesystemGrantStore(filePath, testEncryption(false))

    await expect(
      store.save([{ id: 'grant-1', name: 'project', rootPath: '/private/project' }])
    ).resolves.toBe(false)
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
