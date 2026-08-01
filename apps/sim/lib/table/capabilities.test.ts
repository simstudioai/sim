import { describe, expect, it } from 'vitest'
import { canMutateTable, canRenameTable, shouldUseAsyncTableExport } from '@/lib/table/capabilities'

describe('canMutateTable', () => {
  it('prevents persisted-table actions for virtual tables', () => {
    expect(canMutateTable({ isVirtual: true })).toBe(false)
  })

  it('allows persisted-table actions for stored tables', () => {
    expect(canMutateTable({ isVirtual: false })).toBe(true)
    expect(canMutateTable({})).toBe(true)
  })
})

describe('canRenameTable', () => {
  it('prevents renaming virtual tables such as Memory', () => {
    expect(canRenameTable({ isVirtual: true })).toBe(false)
  })

  it('allows renaming persisted tables', () => {
    expect(canRenameTable({ isVirtual: false })).toBe(true)
    expect(canRenameTable({})).toBe(true)
  })
})

describe('shouldUseAsyncTableExport', () => {
  it('keeps virtual-table exports on the storage-agnostic streaming route', () => {
    expect(
      shouldUseAsyncTableExport({
        isVirtual: true,
        rowCount: 100_000,
        jobType: 'delete',
        jobStatus: 'running',
      })
    ).toBe(false)
  })

  it('uses background exports for large persisted tables', () => {
    expect(
      shouldUseAsyncTableExport({
        isVirtual: false,
        rowCount: 100_000,
        jobType: null,
        jobStatus: null,
      })
    ).toBe(true)
  })

  it('uses background exports while a persisted-table delete is running', () => {
    expect(
      shouldUseAsyncTableExport({
        isVirtual: false,
        rowCount: 1,
        jobType: 'delete',
        jobStatus: 'running',
      })
    ).toBe(true)
  })
})
