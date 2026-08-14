/**
 * @vitest-environment node
 */
import { encryptionMock, encryptionMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMountedFileSecretProvenanceScanner } from '@/lib/execution/mounted-file-secret-provenance'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

describe('mounted file output provenance scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => ({
      decrypted:
        value === 'encrypted-a' ? 'first secret' : value === 'encrypted-b' ? 'line\n"quoted"' : '',
    }))
  })

  it('classifies only mounted secrets present in the exact exported bytes', async () => {
    const scanner = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [
        { encryptedValue: 'encrypted-a' },
        { name: 'ORIGINAL_NAME', encryptedValue: 'encrypted-b' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })

    expect(scanner?.scan(Buffer.from('ordinary output'))).toEqual({ status: 'exact', entries: [] })
    expect(scanner?.scan(Buffer.from('prefix first secret suffix'))).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'MOUNTED_FILE_SECRET',
          encryptedValue: 'encrypted-a',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
    expect(scanner?.scan(Buffer.from('line\\n\\"quoted\\"'))).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'ORIGINAL_NAME',
          encryptedValue: 'encrypted-b',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
  })

  it('reports whether the mount carried any secret material', async () => {
    const withSecrets = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-a' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(withSecrets?.hasSecrets).toBe(true)

    const withoutSecrets = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(withoutSecrets?.hasSecrets).toBe(false)
    expect(withoutSecrets?.scan(Buffer.from('anything'))).toEqual({ status: 'exact', entries: [] })
  })

  it('keeps hasSecrets true when attested entries yield no scannable plaintext', async () => {
    encryptionMockFns.mockDecryptSecret.mockImplementation(async () => ({ decrypted: '' }))

    const scanner = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-a' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })

    expect(scanner?.hasSecrets).toBe(true)
  })

  it('classifies outputs unknown when authenticated mount provenance cannot be inspected', async () => {
    const incomplete = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: false,
      entries: [],
    })
    expect(incomplete?.hasSecrets).toBe(true)
    expect(incomplete?.scan(Buffer.from('raw output'))).toEqual({ status: 'unknown' })

    encryptionMockFns.mockDecryptSecret.mockRejectedValueOnce(new Error('decrypt failed'))
    const unavailable = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-a' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(unavailable?.hasSecrets).toBe(true)
    expect(unavailable?.scan(Buffer.from('raw output'))).toEqual({ status: 'unknown' })
  })
})
