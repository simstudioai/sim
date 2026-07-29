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
    ensureInitialTab: () => {},
    onViewDetached: () => {},
  })
  return panelModule
}

const PANEL_RECT = { x: 400, y: 64, width: 600, height: 800 }

/** A panel showing one tab, which is the state occlusion applies to. */
function showPanel(panel: PanelModule) {
  const win = new BrowserWindow()
  const view = new WebContentsView()
  let active = { id: 'tab-1', view, pinned: false }
  panel.initPanel({
    getMainWindow: () => win,
    activeTab: () => active,
    ensureInitialTab: () => {},
    onViewDetached: () => {},
  })
  panel.setPanelBounds(PANEL_RECT, win)
  /** Swaps in another tab's view, as switching tabs does. */
  const switchTab = (next: WebContentsView) => {
    active = { id: 'tab-2', view: next, pinned: false }
    panel.layout()
  }
  return { win, view, switchTab }
}

/** When the view was hidden, in the global mock invocation order. */
function hiddenAt(view: WebContentsView): number | undefined {
  const call = vi.mocked(view.setVisible).mock.calls.findIndex(([visible]) => visible === false)
  return call === -1 ? undefined : vi.mocked(view.setVisible).mock.invocationCallOrder[call]
}

/** When the replacement frame was pushed to the renderer. */
function snapshotSentAt(win: BrowserWindow): number | undefined {
  const call = vi
    .mocked(win.webContents.send)
    .mock.calls.findIndex(([channel]) => channel === 'browser-agent:panel-snapshot')
  return call === -1 ? undefined : vi.mocked(win.webContents.send).mock.invocationCallOrder[call]
}

describe('panel occlusion', () => {
  let panel: PanelModule

  beforeEach(() => {
    panel = freshPanel()
  })

  it('keeps the page up until its replacement frame exists', async () => {
    const { win, view } = showPanel(panel)

    panel.setPanelOccluded(true, win)

    // Hiding here is what produced the flash: the renderer paints its snapshot
    // as soon as it reports occlusion, and the only frame it holds until the
    // new one lands is the previous overlay's — a different scroll position, or
    // nothing at all.
    expect(hiddenAt(view)).toBeUndefined()
  })

  it('sends the frame before hiding, so the swap shows no seam', async () => {
    const { win, view } = showPanel(panel)

    panel.setPanelOccluded(true, win)
    await vi.waitFor(() => expect(hiddenAt(view)).toBeDefined())

    const sent = snapshotSentAt(win)
    expect(sent).toBeDefined()
    expect(sent).toBeLessThan(hiddenAt(view) as number)
  })

  it('stays visible when the overlay closes while the frame is being taken', async () => {
    const { win, view } = showPanel(panel)

    panel.setPanelOccluded(true, win)
    panel.setPanelOccluded(false, win)
    await vi.waitFor(() => expect(snapshotSentAt(win)).toBeDefined())

    // Hiding after the overlay is gone would blank the page with nothing above it.
    expect(hiddenAt(view)).toBeUndefined()
  })

  it('photographs a visible page as visible, so no scrollbar flashes into the frame', async () => {
    const { win, view } = showPanel(panel)

    panel.setPanelOccluded(true, win)

    // Asking to capture a visible page as hidden moves its visibility state,
    // and Chromium flashes overlay scrollbars across that transition — which
    // the frame then freezes, so the swap shows a scrollbar the page lacked.
    expect(view.webContents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: false })
  })

  it('keeps an already-hidden page hidden when a tab switch needs a frame', async () => {
    const { win, view, switchTab } = showPanel(panel)
    panel.setPanelOccluded(true, win)
    await vi.waitFor(() => expect(hiddenAt(view)).toBeDefined())

    // Switching tabs under an open overlay re-captures, and that panel really
    // is hidden — waking it for the shot is what the flag exists to prevent.
    const next = new WebContentsView()
    switchTab(next)

    expect(next.webContents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
  })

  it('hides anyway when the frame cannot be taken', async () => {
    const { win, view } = showPanel(panel)
    vi.mocked(view.webContents.capturePage).mockRejectedValue(new Error('capture failed'))

    panel.setPanelOccluded(true, win)

    // Waiting forever on a failed capture would leave the page over the overlay.
    await vi.waitFor(() => expect(hiddenAt(view)).toBeDefined())
    expect(snapshotSentAt(win)).toBeUndefined()
  })

  it('accepts occlusion again after the panel is hidden and shown', async () => {
    const { win, view } = showPanel(panel)
    panel.setPanelOccluded(true, win)
    await vi.waitFor(() => expect(hiddenAt(view)).toBeDefined())

    // Hiding the panel forgets both halves of the occlusion state; a stale
    // "already requested" would dedupe the next overlay's report away and leave
    // the page painting over it.
    panel.setPanelBounds(null, win)
    panel.setPanelBounds(PANEL_RECT, win)
    vi.mocked(view.setVisible).mockClear()
    panel.setPanelOccluded(true, win)

    await vi.waitFor(() => expect(hiddenAt(view)).toBeDefined())
  })
})
