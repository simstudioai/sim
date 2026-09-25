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
    restoreActiveScope: () => {},
    onViewDetached: () => {},
  })
  panelModule.activatePanelScope('chat-test')
  return panelModule
}

const PANEL_RECT = { x: 400, y: 64, width: 600, height: 800 }

/** A panel showing one tab. */
function showPanel(panel: PanelModule, onGeometryChanged?: () => void) {
  const win = new BrowserWindow()
  const view = new WebContentsView()
  const active = { id: 'tab-1', scopeId: 'chat-test', view }
  panel.initPanel({
    getMainWindow: () => win,
    activeTab: () => active,
    backgroundColor: () => '#0c0c0c',
    restoreActiveScope: () => {},
    onViewDetached: () => {},
    onGeometryChanged,
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

  it('returns keyboard focus to the renderer when attaching a view steals it mid-typing', () => {
    const win = new BrowserWindow()
    const view = new WebContentsView()
    const active = { id: 'tab-1', scopeId: 'chat-test', view }
    vi.mocked(win.webContents.isFocused).mockReturnValue(true)
    panel.initPanel({
      getMainWindow: () => win,
      activeTab: () => active,
      backgroundColor: () => '#0c0c0c',
      restoreActiveScope: () => {},
      onViewDetached: () => {},
    })
    panel.activatePanelScope('chat-test')
    panel.setPanelBounds(PANEL_RECT, win)
    expect(win.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(win.webContents.focus).toHaveBeenCalled()
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

  it('captures a lossless native-resolution frame before changing native-view visibility', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(view.setVisible).mockClear()
    vi.mocked(view.setBounds).mockClear()
    vi.mocked(view.webContents.invalidate).mockClear()

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.toEqual({
      dataUrl: 'data:image/png;base64,c2lt',
      tabId: 'tab-1',
      zoomPercent: 110,
      scopeId,
      viewportBounds: { x: 400, y: 64, width: 600, height: 786 },
    })
    expect(view.webContents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: false })
    const captureResult = vi.mocked(view.webContents.capturePage).mock.results[0]
    if (!captureResult) throw new Error('Expected capturePage to return a frame')
    const image = await captureResult.value
    expect(image.resize).not.toHaveBeenCalled()
    expect(image.toJPEG).not.toHaveBeenCalled()
    expect(image.toDataURL).toHaveBeenCalledOnce()
    expect(view.setVisible).not.toHaveBeenCalled()

    expect(panel.setPanelOccluded(true, win, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(view.setBounds).not.toHaveBeenCalled()

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.toMatchObject({
      dataUrl: 'data:image/png;base64,c2lt',
      viewportBounds: { x: 400, y: 64, width: 600, height: 786 },
    })
    expect(view.webContents.capturePage).toHaveBeenLastCalledWith(undefined, { stayHidden: true })
    expect(view.setVisible).not.toHaveBeenCalledWith(true)

    expect(panel.setPanelOccluded(false, win, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.webContents.invalidate).toHaveBeenCalledOnce()
    expect(view.setBounds).not.toHaveBeenCalled()
  })

  it('recovers when capturePage throws before returning a promise', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    const image = await view.webContents.capturePage()
    vi.mocked(view.webContents.capturePage).mockImplementationOnce(() => {
      throw new Error('WebContents was destroyed')
    })

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.toBeNull()

    vi.mocked(view.webContents.capturePage).mockResolvedValue(image)
    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.toMatchObject({
      dataUrl: 'data:image/png;base64,c2lt',
    })
  })

  it('does not dedupe a queued capture across panel owner windows', async () => {
    const { win, view } = showPanel(panel)
    const other = new BrowserWindow()
    const scopeId = panel.getActivePanelScopeId()
    const image = await view.webContents.capturePage()
    const pendingCaptures: Array<(value: typeof image) => void> = []
    vi.mocked(view.webContents.capturePage).mockClear()
    vi.mocked(view.webContents.capturePage).mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingCaptures.push(resolve)
        })
    )

    const first = panel.capturePanelSnapshot(win, scopeId)
    panel.setPanelBounds(PANEL_RECT, other)
    const second = panel.capturePanelSnapshot(other, scopeId)

    expect(view.webContents.capturePage).toHaveBeenCalledOnce()
    pendingCaptures[0]?.(image)
    await expect(first).resolves.toBeNull()
    await vi.waitFor(() => expect(view.webContents.capturePage).toHaveBeenCalledTimes(2))

    pendingCaptures[1]?.(image)
    await expect(second).resolves.toMatchObject({ dataUrl: 'data:image/png;base64,c2lt' })
  })

  it('serializes native captures and coalesces queued navigation requests to the latest page', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    const image = await view.webContents.capturePage()
    const pendingCaptures: Array<(value: typeof image) => void> = []
    vi.mocked(view.webContents.capturePage).mockClear()
    vi.mocked(view.webContents.capturePage).mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingCaptures.push(resolve)
        })
    )

    vi.mocked(view.webContents.getURL).mockReturnValue('https://one.example')
    const first = panel.capturePanelSnapshot(win, scopeId)
    vi.mocked(view.webContents.getURL).mockReturnValue('https://two.example')
    const superseded = panel.capturePanelSnapshot(win, scopeId)
    vi.mocked(view.webContents.getURL).mockReturnValue('https://three.example')
    const latest = panel.capturePanelSnapshot(win, scopeId)

    expect(view.webContents.capturePage).toHaveBeenCalledOnce()
    await expect(superseded).resolves.toBeNull()
    pendingCaptures[0]?.(image)
    await expect(first).resolves.toBeNull()
    await vi.waitFor(() => expect(view.webContents.capturePage).toHaveBeenCalledTimes(2))

    pendingCaptures[1]?.(image)
    await expect(latest).resolves.toMatchObject({ dataUrl: 'data:image/png;base64,c2lt' })
    expect(view.webContents.capturePage).toHaveBeenCalledTimes(2)
  })

  it('refuses a panel capture whose pixel budget is unsafe', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(win.getContentSize).mockReturnValue([10_000, 10_000])
    panel.setPanelBounds({ x: 0, y: 0, width: 5_000, height: 5_000 }, win)
    vi.mocked(view.webContents.capturePage).mockClear()

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.toBeNull()
    expect(view.webContents.capturePage).not.toHaveBeenCalled()
  })

  it('force-hides the native page when its replacement was captured at stale bounds', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.not.toBeNull()
    panel.setPanelBounds({ x: 399, y: 64, width: 601, height: 786 }, win)
    vi.mocked(view.setVisible).mockClear()

    expect(panel.setPanelOccluded(true, win, scopeId)).toBe(false)
    expect(view.setVisible).not.toHaveBeenCalled()

    expect(panel.setPanelOccluded(true, win, scopeId, true)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('releases the old window occlusion lease when panel ownership moves', async () => {
    const { win, view } = showPanel(panel)
    const other = new BrowserWindow()
    const scopeId = panel.getActivePanelScopeId()

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.not.toBeNull()
    expect(panel.setPanelOccluded(true, win, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)

    panel.setPanelBounds(PANEL_RECT, other)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    // The displaced renderer can retire its stale local snapshot without
    // changing the new owner's already-visible native view.
    expect(panel.setPanelOccluded(false, win, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('refuses to hide the page for a stale chat scope', () => {
    const { win, view } = showPanel(panel)
    vi.mocked(view.setVisible).mockClear()

    expect(panel.setPanelOccluded(true, win, 'some-other-chat')).toBe(false)
    expect(panel.setPanelOccluded(true, win, 'some-other-chat', true)).toBe(false)
    expect(view.setVisible).not.toHaveBeenCalled()
  })
})
