import { encryptionMock, encryptionMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMountedFileSecretProvenanceScanner } from '@/lib/execution/mounted-file-secret-provenance'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

describe('mounted file output provenance scanner', () => {
  beforeEach(() => {
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => ({
      decrypted:
        value === 'encrypted-a' ? 'first secret' : value === 'encrypted-b' ? 'line\n"quoted"' : '',
    }))
  })

  it('retains full mounted lineage while narrowing text exports to matching literals', async () => {
    const scanner = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [
        { encryptedValue: 'encrypted-a' },
        { name: 'ORIGINAL_NAME', encryptedValue: 'encrypted-b' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })

    expect(scanner?.provenance).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'MOUNTED_FILE_SECRET',
          encryptedValue: 'encrypted-a',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
        {
          name: 'ORIGINAL_NAME',
          encryptedValue: 'encrypted-b',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
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

  it('keeps a mount without secret material exact-empty', async () => {
    const withoutSecrets = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(withoutSecrets?.provenance).toEqual({ status: 'exact', entries: [] })
    expect(withoutSecrets?.scan(Buffer.from('anything'))).toEqual({ status: 'exact', entries: [] })
  })

  it('keeps attested entries unknown when they yield no plaintext', async () => {
    encryptionMockFns.mockDecryptSecret.mockImplementation(async () => ({ decrypted: '' }))

    const scanner = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-a' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })

    expect(scanner?.provenance).toEqual({ status: 'unknown' })
    expect(scanner?.scan(Buffer.from('ordinary output'))).toEqual({ status: 'unknown' })
  })

  it.each(['false', 'hunter2', '""""'])(
    'excludes short plaintext %j before escaping it',
    async (plaintext) => {
      encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: plaintext })

      const scanner = await createMountedFileSecretProvenanceScanner({
        version: 1,
        complete: true,
        entries: [{ encryptedValue: 'encrypted-short' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      })

      expect(scanner?.scan(Buffer.from(JSON.stringify(plaintext)))).toEqual({
        status: 'exact',
        entries: [],
      })
      expect(scanner?.provenance).toEqual({ status: 'exact', entries: [] })
    }
  )

  it('protects an eight-character literal alongside excluded short entries', async () => {
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => ({
      decrypted: value === 'encrypted-short' ? 'false' : 'hunter22',
    }))

    const scanner = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-short' }, { encryptedValue: 'encrypted-boundary' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })

    expect(scanner?.provenance).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'MOUNTED_FILE_SECRET',
          encryptedValue: 'encrypted-boundary',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
    expect(scanner?.scan(Buffer.from('false hunter22'))).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'MOUNTED_FILE_SECRET',
          encryptedValue: 'encrypted-boundary',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
  })

  it('classifies outputs unknown when authenticated mount provenance cannot be inspected', async () => {
    const incomplete = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: false,
      entries: [],
    })
    expect(incomplete?.provenance).toEqual({ status: 'unknown' })
    expect(incomplete?.scan(Buffer.from('raw output'))).toEqual({ status: 'unknown' })

    encryptionMockFns.mockDecryptSecret.mockRejectedValueOnce(new Error('decrypt failed'))
    const unavailable = await createMountedFileSecretProvenanceScanner({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-a' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(unavailable?.provenance).toEqual({ status: 'unknown' })
    expect(unavailable?.scan(Buffer.from('raw output'))).toEqual({ status: 'unknown' })
  })
})
