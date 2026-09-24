/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  disableTinProjection,
  TIN_TRIGGERS,
  type TinProjectionDatabase,
  type TinProjectionState,
} from '@/scripts/dormant-org-search/disable-tin-projection'

/** A database whose Tin triggers and rows change only through the calls under test. */
function fakeDatabase(initial: Partial<TinProjectionState> = {}) {
  const state: TinProjectionState = {
    triggers: [...TIN_TRIGGERS],
    hasRows: true,
    estimatedRows: 1_000,
    totalBytes: 8_192,
    functionsInstalled: true,
    ...initial,
  }
  const database: TinProjectionDatabase & { drops: number } = {
    drops: 0,
    readState: async () => ({ ...state, triggers: [...state.triggers] }),
    dropTriggersAndTruncate: async () => {
      database.drops += 1
      state.triggers = []
      state.hasRows = false
      state.totalBytes = 0
    },
  }
  return { database, state }
}

describe('disableTinProjection', () => {
  it('drops nothing in a dry run', async () => {
    const { database } = fakeDatabase()
    const result = await disableTinProjection(database, { execute: false })
    expect(database.drops).toBe(0)
    expect(result).toMatchObject({ executed: false, after: null })
    expect(result.before.triggers.map((trigger) => trigger.name)).toEqual([
      'embedding_keyword_tin_sync',
      'knowledge_base_keyword_tin_sync',
      'embedding_keyword_tin_source_acl_set',
    ])
  })

  it('drops the triggers and truncates when executing', async () => {
    const { database } = fakeDatabase()
    const result = await disableTinProjection(database, { execute: true })
    expect(database.drops).toBe(1)
    expect(result.after).toMatchObject({ triggers: [], hasRows: false })
  })

  it('does nothing when the triggers are gone and the table is empty', async () => {
    const { database } = fakeDatabase({ triggers: [], hasRows: false, estimatedRows: -1 })
    const result = await disableTinProjection(database, { execute: true })
    expect(database.drops).toBe(0)
    expect(result.executed).toBe(false)
  })

  it('truncates again when only rows remain', async () => {
    const { database } = fakeDatabase({ triggers: [] })
    await disableTinProjection(database, { execute: true })
    expect(database.drops).toBe(1)
  })

  it('fails when a trigger survives the drop', async () => {
    const { database, state } = fakeDatabase()
    database.dropTriggersAndTruncate = async () => {
      state.triggers = [TIN_TRIGGERS[0]]
    }
    await expect(disableTinProjection(database, { execute: true })).rejects.toThrow(
      'still installed'
    )
  })
})
