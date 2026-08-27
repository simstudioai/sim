/**
 * @vitest-environment jsdom
 *
 * Deselecting a block must not end a workflow search.
 *
 * `clearCurrentBlock` used to clear `activeSearchTarget` too, which made a Note
 * match unrenderable: the editor answers a Note by deselecting it, destroying
 * the target the Note card was about to paint. The search panel owns that
 * target's lifetime — it re-asserts it on every match change and clears it on
 * close — so nothing else may reach in and drop it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'
import { usePanelEditorSearchStore, usePanelEditorStore } from '@/stores/panel/editor/store'

const NOTE_SEARCH_TARGET: ActiveSearchTarget = {
  matchId: 'text:note-1:content:0',
  blockId: 'note-1',
  subBlockId: 'content',
  canonicalSubBlockId: 'content',
  valuePath: [],
  kind: 'text',
  targetKind: 'subblock',
  subBlockType: 'long-input',
  rawValue: 'SB_ACTION_ROUTER_SECRET',
  searchText: 'uses SB_ACTION_ROUTER_SECRET here',
  query: 'SB_ACTION_ROUTER_SECRET',
  range: { start: 5, end: 28 },
}

beforeEach(() => {
  usePanelEditorSearchStore.setState({ activeSearchTarget: null })
  usePanelEditorStore.setState({ currentBlockId: null })
})

describe('clearCurrentBlock', () => {
  it('clears the selected block', () => {
    usePanelEditorStore.getState().setCurrentBlockId('block-1')
    usePanelEditorStore.getState().clearCurrentBlock()
    expect(usePanelEditorStore.getState().currentBlockId).toBeNull()
  })

  it('leaves the active search target in place', () => {
    usePanelEditorSearchStore.getState().setActiveSearchTarget(NOTE_SEARCH_TARGET)
    usePanelEditorStore.getState().setCurrentBlockId('note-1')

    usePanelEditorStore.getState().clearCurrentBlock()

    expect(usePanelEditorSearchStore.getState().activeSearchTarget).toEqual(NOTE_SEARCH_TARGET)
  })
})

describe('setActiveSearchTarget', () => {
  it('clears the target when the search panel asks it to', () => {
    usePanelEditorSearchStore.getState().setActiveSearchTarget(NOTE_SEARCH_TARGET)
    usePanelEditorSearchStore.getState().setActiveSearchTarget(null)
    expect(usePanelEditorSearchStore.getState().activeSearchTarget).toBeNull()
  })
})
