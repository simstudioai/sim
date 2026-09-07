/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipHandoffStorage, STORAGE_KEYS } from '@/lib/core/utils/browser-storage'
import type { ChatContext } from '@/stores/panel'

const WS = 'ws-1'

/** A chip-only handoff context — the highlight-to-chat payload. */
function chipContext(): ChatContext {
  return { kind: 'file_selection', fileId: 'f1', fileName: 'a.md', label: 'a.md', text: 'a' }
}

describe('MothershipHandoffStorage', () => {
  it('keeps organization recovery separate from all workspace and other organization mounts', () => {
    const handoff = {
      message: 'Find the policy',
      resumeUserMessageId: 'original-send',
      requestMode: 'assistant' as const,
    }
    expect(MothershipHandoffStorage.store(handoff, { organizationId: 'org-1' })).toBe(true)
    expect(MothershipHandoffStorage.consume('org-1')).toBeNull()
    expect(MothershipHandoffStorage.consume({ organizationId: 'org-2' })).toBeNull()
    expect(MothershipHandoffStorage.consume({ organizationId: 'org-1' })).toEqual({
      ...handoff,
      contexts: [],
    })
    expect(MothershipHandoffStorage.consume({ organizationId: 'org-1' })).toBeNull()
  })

  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a handoff and trims the message, preserving contexts', () => {
    const contexts: ChatContext[] = [{ kind: 'logs', executionId: 'run-1', label: 'My Flow' }]
    expect(MothershipHandoffStorage.store({ message: '  fix it  ', contexts }, WS)).toBe(true)

    expect(MothershipHandoffStorage.consume(WS)).toEqual({ message: 'fix it', contexts })
  })

  it('retains the selected document and filters when Search hands off to Assistant', () => {
    const assistantSearch = {
      source: 'slack',
      modifiedAfter: '2026-09-01T00:00:00.000Z',
      documentIds: ['selected-doc'],
    }
    MothershipHandoffStorage.store(
      { message: 'Summarize this', requestMode: 'assistant', assistantSearch },
      WS
    )
    expect(MothershipHandoffStorage.consume(WS)).toEqual({
      message: 'Summarize this',
      contexts: [],
      requestMode: 'assistant',
      assistantSearch,
    })
  })

  it('discards a corrupted scope instead of silently widening the Assistant request', () => {
    localStorage.setItem(
      STORAGE_KEYS.MOTHERSHIP_HANDOFF,
      JSON.stringify({
        message: 'Summarize this',
        workspaceId: WS,
        timestamp: Date.now(),
        requestMode: 'assistant',
        assistantSearch: { documentIds: [] },
      })
    )
    expect(MothershipHandoffStorage.consume(WS)).toBeNull()
  })

  it('is one-shot — a second consume returns null', () => {
    MothershipHandoffStorage.store({ message: 'fix it' }, WS)

    expect(MothershipHandoffStorage.consume(WS)).not.toBeNull()
    expect(MothershipHandoffStorage.consume(WS)).toBeNull()
  })

  it('refuses to store without a workspace, or with neither a message nor a context', () => {
    expect(MothershipHandoffStorage.store({ message: '   ' }, WS)).toBe(false)
    expect(MothershipHandoffStorage.store({ contexts: [] }, WS)).toBe(false)
    expect(MothershipHandoffStorage.store({}, WS)).toBe(false)
    expect(MothershipHandoffStorage.store({ message: 'fix it' }, '')).toBe(false)
    expect(MothershipHandoffStorage.consume(WS)).toBeNull()
  })

  it('leaves a handoff owned by another workspace untouched for its owner', () => {
    MothershipHandoffStorage.store({ message: 'fix it' }, WS)

    // A different workspace must not claim it, and must not clear it.
    expect(MothershipHandoffStorage.consume('ws-other')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).not.toBeNull()

    // The owning workspace still consumes it.
    expect(MothershipHandoffStorage.consume(WS)).toEqual({ message: 'fix it', contexts: [] })
  })

  it('stores a chip-only handoff (no message) and returns it without one', () => {
    const contexts: ChatContext[] = [
      {
        kind: 'file_selection',
        fileId: 'f1',
        fileName: 'notes.md',
        label: 'notes.md:2-4',
        text: 'passage',
      },
    ]
    expect(MothershipHandoffStorage.store({ contexts }, WS)).toBe(true)

    expect(MothershipHandoffStorage.consume(WS)).toEqual({ contexts })
  })

  it('accumulates chip-only handoffs so a second add before navigation is not dropped', () => {
    const first = chipContext()
    const second: ChatContext = {
      kind: 'table_selection',
      tableId: 't1',
      tableName: 'T',
      label: 'T (1 row)',
      rowIds: ['r'],
    }
    MothershipHandoffStorage.store({ contexts: [first] }, WS)
    MothershipHandoffStorage.store({ contexts: [second] }, WS)

    expect(MothershipHandoffStorage.consume(WS)).toEqual({ contexts: [first, second] })
  })

  it('does not revive chips from a handoff that already aged out', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const abandoned = chipContext()
      MothershipHandoffStorage.store({ contexts: [abandoned] }, WS)

      // The user walks away; the handoff expires in place. A later "Add to chat"
      // stamps a fresh timestamp, which must not carry the dead chip forward.
      vi.advanceTimersByTime(61 * 1000)
      const fresh: ChatContext = {
        kind: 'table_selection',
        tableId: 't1',
        tableName: 'T',
        label: 'T (1 row)',
        rowIds: ['r'],
      }
      MothershipHandoffStorage.store({ contexts: [fresh] }, WS)

      expect(MothershipHandoffStorage.consume(WS)).toEqual({ contexts: [fresh] })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not accumulate chips onto a message handoff, or across workspaces', () => {
    const chip = chipContext()
    MothershipHandoffStorage.store({ contexts: [chip] }, WS)
    // A message handoff replaces rather than inheriting the pending chips.
    MothershipHandoffStorage.store({ message: 'fix it' }, WS)
    expect(MothershipHandoffStorage.consume(WS)).toEqual({ message: 'fix it', contexts: [] })

    MothershipHandoffStorage.store({ contexts: [chip] }, WS)
    MothershipHandoffStorage.store({ contexts: [chip] }, 'ws-other')
    expect(MothershipHandoffStorage.consume('ws-other')).toEqual({ contexts: [chip] })
  })

  it('tombstones a corrupted entry (missing timestamp) instead of leaving it forever', () => {
    localStorage.setItem(
      STORAGE_KEYS.MOTHERSHIP_HANDOFF,
      JSON.stringify({ message: 'fix it', workspaceId: WS })
    )

    expect(MothershipHandoffStorage.consume(WS)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).toBeNull()
  })

  it('tombstones a legacy entry (message + timestamp, no workspaceId) rather than firing it', () => {
    // The old pre-scoping format could be sitting in storage across a deploy —
    // it must be discarded, not attributed to the current workspace.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      localStorage.setItem(
        STORAGE_KEYS.MOTHERSHIP_HANDOFF,
        JSON.stringify({ message: 'fix it', timestamp: Date.now() })
      )

      expect(MothershipHandoffStorage.consume(WS)).toBeNull()
      expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops and clears a handoff older than maxAge', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      MothershipHandoffStorage.store({ message: 'fix it' }, WS)

      vi.advanceTimersByTime(61 * 1000)

      expect(MothershipHandoffStorage.consume(WS)).toBeNull()
      expect(localStorage.getItem(STORAGE_KEYS.MOTHERSHIP_HANDOFF)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
