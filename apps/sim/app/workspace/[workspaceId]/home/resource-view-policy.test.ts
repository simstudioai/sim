import { describe, expect, it } from 'vitest'
import { resolveResourceEventPresentation } from '@/app/workspace/[workspaceId]/home/resource-view-policy'

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

  it('follows agent work after the user-selected resource is removed', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activeResourceId: null,
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
