import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { BrowserWindow, WebContentsView } from 'electron'
import * as panelModule from '@/main/browser-agent/panel'

type PanelModule = typeof import('@/main/browser-agent/panel')

/**
 * `initPanel` is a full reset of the module's session state, so a clean panel
 * needs no module reload — which is what lets this file use a static import
 * instead of the `vi.resetModules()` the root CLAUDE.md forbids.
 *
 * The reset happens here rather than being left to `showPanel`, so a test that
 * never shows a panel still starts from a clean one.
 */
function freshPanel(): PanelModule {
  panelModule.initPanel({
    getMainWindow: () => null,
    activeTab: () => null,
    backgroundColor: () => '#ffffff',
    ensureInitialTab: () => {},
    onViewDetached: () => {},
  })
  panelModule.activatePanelScope('chat-test')
  return panelModule
}

const PANEL_RECT = { x: 400, y: 64, width: 600, height: 800 }

/** A panel showing one tab. */
function showPanel(panel: PanelModule) {
  const win = new BrowserWindow()
  const view = new WebContentsView()
  const active = { id: 'tab-1', scopeId: 'chat-test', view, pinned: false }
  panel.initPanel({
    getMainWindow: () => win,
    activeTab: () => active,
    backgroundColor: () => '#0c0c0c',
    ensureInitialTab: () => {},
    onViewDetached: () => {},
  })
  panel.activatePanelScope('chat-test')
  panel.setPanelBounds(PANEL_RECT, win)
  return { win, view }
}

describe('panel chat scope', () => {
  let panel: PanelModule

  beforeEach(() => {
    panel = freshPanel()
  })

  it('requires fresh bounds for the newly active chat and ignores stale reports', () => {
    const { win, view } = showPanel(panel)
    const previousScope = panel.getActivePanelScopeId()
    const nextScope = `${previousScope}:next`

    panel.activatePanelScope(nextScope)
    expect(win.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(panel.isPanelVisible()).toBe(false)

    panel.setPanelBounds(PANEL_RECT, win, undefined, previousScope)
    expect(panel.isPanelVisible()).toBe(false)

    panel.setPanelBounds(PANEL_RECT, win, undefined, nextScope)
    expect(panel.isPanelVisible()).toBe(true)
  })

  it('captures a bounded frame before changing native-view visibility', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(view.setVisible).mockClear()
    vi.mocked(view.setBounds).mockClear()

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,c2lt',
      tabId: 'tab-1',
      zoomPercent: 110,
      scopeId,
    })
    expect(view.webContents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: false })
    expect(view.setVisible).not.toHaveBeenCalled()

    expect(panel.setPanelOccluded(true, win, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(view.setBounds).not.toHaveBeenCalled()

    expect(panel.setPanelOccluded(false, win, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.setBounds).not.toHaveBeenCalled()
  })

  it('treats an unpainted blank tab as a valid backdrop snapshot', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(view.webContents.getURL).mockReturnValue('about:blank')
    vi.mocked(view.webContents.capturePage).mockClear()

    const snapshot = await panel.capturePanelSnapshot(win, scopeId)

    expect(snapshot).toMatchObject({
      tabId: 'tab-1',
      zoomPercent: 110,
      scopeId,
    })
    expect(snapshot?.dataUrl).toContain('data:image/svg+xml,')
    expect(decodeURIComponent(snapshot?.dataUrl ?? '')).toContain('fill="#0c0c0c"')
    expect(view.webContents.capturePage).not.toHaveBeenCalled()
  })

  it('refuses to hide the page for a stale chat scope', () => {
    const { win, view } = showPanel(panel)
    vi.mocked(view.setVisible).mockClear()

    expect(panel.setPanelOccluded(true, win, 'some-other-chat')).toBe(false)
    expect(view.setVisible).not.toHaveBeenCalled()
  })
})
