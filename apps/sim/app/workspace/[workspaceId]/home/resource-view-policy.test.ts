import { describe, expect, it } from 'vitest'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import {
  resolveEffectiveResourceId,
  resolveResourceEventPresentation,
  resolveResourceSelectionUpdate,
} from '@/app/workspace/[workspaceId]/home/resource-view-policy'

const PAGES: MothershipResource[] = [
  { type: 'browser', id: '1', title: 'Page 1' },
  { type: 'browser', id: '2', title: 'Page 2' },
  { type: 'browser', id: '3', title: 'Page 3' },
]
const NOTES: MothershipResource = { type: 'file', id: 'notes', title: 'notes.md' }
const SHELLS: MothershipResource[] = [
  { type: 'terminal', id: 'terminal:1', title: 'one' },
  { type: 'terminal', id: 'terminal:2', title: 'two' },
]
const NO_NATIVE = { browser: null, terminal: null }

describe('resolveEffectiveResourceId', () => {
  it('shows nothing when the strip is empty', () => {
    expect(resolveEffectiveResourceId([], null, NO_NATIVE)).toBeNull()
    expect(resolveEffectiveResourceId([], 'anything', NO_NATIVE)).toBeNull()
  })

  it('shows the selected resource while it is on screen', () => {
    expect(resolveEffectiveResourceId(PAGES, '1', { browser: '3', terminal: null })).toBe('1')
  })

  it('falls back when the selection is no longer on screen', () => {
    expect(resolveEffectiveResourceId(PAGES, 'deleted', NO_NATIVE)).toBe('3')
  })

  it('prefers the page the desktop app shows over the last one', () => {
    expect(resolveEffectiveResourceId(PAGES, null, { browser: '2', terminal: null })).toBe('2')
  })

  it('prefers the shell the desktop app shows over the last one', () => {
    expect(
      resolveEffectiveResourceId(SHELLS, null, { browser: null, terminal: 'terminal:1' })
    ).toBe('terminal:1')
  })

  it('keeps the last resource when the desktop app reports nothing', () => {
    expect(resolveEffectiveResourceId(PAGES, null, NO_NATIVE)).toBe('3')
    expect(resolveEffectiveResourceId(PAGES, null)).toBe('3')
  })

  it('ignores a page the strip no longer holds, such as one just closed', () => {
    expect(resolveEffectiveResourceId(PAGES, null, { browser: 'closed', terminal: null })).toBe('3')
  })

  it('ignores the desktop app when the last resource is not one of its tabs', () => {
    expect(
      resolveEffectiveResourceId([...PAGES, NOTES], null, { browser: '2', terminal: null })
    ).toBe('notes')
  })

  it('does not cross the two desktop kinds', () => {
    expect(resolveEffectiveResourceId(PAGES, null, { browser: null, terminal: 'terminal:1' })).toBe(
      '3'
    )
    expect(resolveEffectiveResourceId(SHELLS, null, { browser: '1', terminal: null })).toBe(
      'terminal:2'
    )
  })
})

const DEFAULT_INPUT = {
  activeResourceId: 'file-1',
  activationRequested: true,
  panelCollapseOwnedByUser: false,
  panelCollapsed: false,
  resourceId: 'file-2',
  selectionOwnedByUser: false,
} as const

describe('resolveResourceEventPresentation', () => {
  it('reveals an automatically collapsed panel and follows agent work', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: true,
      markActivity: false,
      revealPanel: true,
    })
  })

  it('keeps a manually collapsed panel closed and marks activity', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        panelCollapseOwnedByUser: true,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })

  it('marks repeated work on the active resource while manually collapsed', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activeResourceId: 'file-2',
        panelCollapseOwnedByUser: true,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })

  it('preserves a user-selected resource and marks background activity', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        selectionOwnedByUser: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })

  it('allows the active user-selected resource to continue receiving updates', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activeResourceId: 'file-2',
        selectionOwnedByUser: true,
      })
    ).toEqual({
      activateResource: true,
      markActivity: false,
      revealPanel: false,
    })
  })

  it('follows same-batch agent work after the user-selected resource is removed', () => {
    const activeResourceId = resolveResourceSelectionUpdate('file-1', (currentResourceId) =>
      currentResourceId === 'file-1' ? null : currentResourceId
    )

    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activeResourceId,
        selectionOwnedByUser: true,
      })
    ).toEqual({
      activateResource: true,
      markActivity: false,
      revealPanel: false,
    })
  })

  it('honors an event that declines activation without revealing the panel', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activationRequested: false,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })
})
