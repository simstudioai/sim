/**
 * @vitest-environment node
 */
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import { importedRowSources, resolveImportedRowProvenance } from '@/lib/table/import-provenance'

/** Leading zeros a number column drops, so the coerced cell no longer holds the secret's text. */
const SECRET = '0042424242424242'
const SOURCE = { workspaceId: 'workspace-1', userId: 'user-1', fileKey: 'imports/file.csv' }

function storeSource(provenance: unknown) {
  workspaceFileSecretProvenanceMockFns.mockGetStoredFileSecretProvenanceByKey.mockResolvedValue(
    new Map([[SOURCE.fileKey, provenance]])
  )
}

beforeEach(() => {
  encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => ({
    decrypted: value.slice('enc:'.length),
  }))
  storeSource({
    status: 'exact',
    entries: [{ name: 'CARD', encryptedValue: `enc:${SECRET}`, sourceUserId: 'user-1' }],
  })
})

describe('resolveImportedRowProvenance', () => {
  it('gives each cell the secrets its stored text contains', async () => {
    const stamp = await resolveImportedRowProvenance(SOURCE)
    const row = { c_card: `card ${SECRET}`, c_note: 'plain' }
    const written = stamp(row, { ...row })
    expect(written.complete).toBe(true)
    expect(written.columns.c_card?.entries).toHaveLength(1)
    expect(written.columns.c_note?.entries).toEqual([])
  })

  it('makes a row unknown when coercion rewrote a cell that held a secret', async () => {
    const stamp = await resolveImportedRowProvenance(SOURCE)
    /** A number column parses the secret; the stored value no longer matches its text. */
    const written = stamp({ c_card: Number(SECRET) }, { c_card: SECRET })
    expect(written.complete).toBe(false)
  })

  it('keeps a row exact when coercion rewrote only cells without secrets', async () => {
    const stamp = await resolveImportedRowProvenance(SOURCE)
    const written = stamp({ c_count: 7, c_empty: null }, { c_count: '7', c_empty: `x ${SECRET}` })
    expect(written.complete).toBe(true)
  })

  it.each([
    ['a clean file', { status: 'exact', entries: [] }],
    ['an unrecorded file', { status: 'unrecorded' }],
    ['a key no file names', undefined],
  ])('keeps rows from %s exact-empty, as before', async (_case, provenance) => {
    storeSource(provenance)
    const stamp = await resolveImportedRowProvenance(SOURCE)
    expect(stamp({ c_card: 7 }, { c_card: SECRET })).toEqual({
      complete: true,
      columns: { c_card: { version: 1, complete: true, entries: [] } },
    })
  })

  it('makes every row from an unknown file unknown', async () => {
    storeSource({ status: 'unknown' })
    const stamp = await resolveImportedRowProvenance(SOURCE)
    expect(stamp({ c_note: 'plain' }, { c_note: 'plain' }).complete).toBe(false)
  })
})

describe('importedRowSources', () => {
  it('keys each raw cell by the column id its header maps to', () => {
    const sources = importedRowSources(
      [{ Amount: '12.50', Ignored: 'x' }],
      { columns: [{ id: 'col_amount', name: 'amount', type: 'number' }] },
      new Map([['Amount', 'amount']])
    )
    expect(sources).toEqual([{ col_amount: '12.50' }])
  })
})
