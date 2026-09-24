/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/script-migrations/0019_tin_keyword_projection', () => ({
  installProjection: vi.fn(),
  backfillProjection: vi.fn(),
}))
vi.mock('@sim/db/script-migrations/0024_knowledge_projection_async', () => ({
  installKnowledgeProjectionAsync: vi.fn(),
}))

import {
  TIN_TRIGGERS,
  type TinProjectionDatabase,
  type TinProjectionState,
} from '@/scripts/dormant-org-search/disable-tin-projection'
import {
  restoreTinProjection,
  type TinRestoreSteps,
} from '@/scripts/dormant-org-search/restore-tin-projection'

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

function fakeSteps(onInstall: () => void) {
  const calls: string[] = []
  const steps: TinRestoreSteps = {
    installProjection: async () => {
      calls.push('0019 installProjection')
    },
    installKnowledgeProjectionAsync: async () => {
      calls.push('0024 installKnowledgeProjectionAsync')
      onInstall()
    },
    backfillProjection: async () => {
      calls.push('0019 backfillProjection')
      return 42
    },
  }
  return { steps, calls }
}

describe('restoreTinProjection', () => {
  it('runs nothing in a dry run', async () => {
    const { database } = fakeDatabase({ triggers: [], hasRows: false })
    const { steps, calls } = fakeSteps(() => undefined)
    const result = await restoreTinProjection(database, steps, { execute: false, backfill: true })
    expect(calls).toEqual([])
    expect(result).toEqual({ executed: false, backfilled: null })
  })

  it('reinstalls from 0019 then re-guards with 0024, and backfills only when asked', async () => {
    const { database, state } = fakeDatabase({ triggers: [], hasRows: false })
    const { steps, calls } = fakeSteps(() => {
      state.triggers = [...TIN_TRIGGERS]
    })
    expect(await restoreTinProjection(database, steps, { execute: true, backfill: false })).toEqual(
      { executed: true, backfilled: null }
    )
    expect(calls).toEqual(['0019 installProjection', '0024 installKnowledgeProjectionAsync'])

    calls.length = 0
    expect(await restoreTinProjection(database, steps, { execute: true, backfill: true })).toEqual({
      executed: true,
      backfilled: 42,
    })
    expect(calls.at(-1)).toBe('0019 backfillProjection')
  })

  it('fails when a trigger is still missing after the install', async () => {
    const { database } = fakeDatabase({ triggers: [] })
    const { steps, calls } = fakeSteps(() => undefined)
    await expect(
      restoreTinProjection(database, steps, { execute: true, backfill: true })
    ).rejects.toThrow('missing after restore')
    expect(calls).not.toContain('0019 backfillProjection')
  })

  it('refuses where the Tin functions were never installed', async () => {
    const { database } = fakeDatabase({ triggers: [], functionsInstalled: false })
    const { steps, calls } = fakeSteps(() => undefined)
    await expect(
      restoreTinProjection(database, steps, { execute: true, backfill: false })
    ).rejects.toThrow('not installed')
    expect(calls).toEqual([])
  })
})
