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

  it('returns keyboard focus to the renderer when attaching a view steals it mid-typing', () => {
    const win = new BrowserWindow()
    const view = new WebContentsView()
    const active = { id: 'tab-1', scopeId: 'chat-test', view, pinned: false }
    vi.mocked(win.webContents.isFocused).mockReturnValue(true)
    panel.initPanel({
      getMainWindow: () => win,
      activeTab: () => active,
      backgroundColor: () => '#0c0c0c',
      ensureInitialTab: () => {},
      onViewDetached: () => {},
    })
    panel.activatePanelScope('chat-test')
    panel.setPanelBounds(PANEL_RECT, win)
    expect(win.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(win.webContents.focus).toHaveBeenCalled()
  })

  it('leaves focus untouched when the renderer was not focused at attach time', () => {
    const { win, view } = showPanel(panel)
    expect(win.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(win.webContents.focus).not.toHaveBeenCalled()
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

  it('shares one native capture across concurrent requests for the same frame', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    let resolveCapture:
      | ((image: Awaited<ReturnType<typeof view.webContents.capturePage>>) => void)
      | undefined
    const image = await view.webContents.capturePage()
    vi.mocked(view.webContents.capturePage).mockClear()
    vi.mocked(view.webContents.capturePage).mockReturnValue(
      new Promise((resolve) => {
        resolveCapture = resolve
      })
    )

    const first = panel.capturePanelSnapshot(win, scopeId)
    const second = panel.capturePanelSnapshot(win, scopeId)
    expect(view.webContents.capturePage).toHaveBeenCalledOnce()
    resolveCapture?.(image)

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(view.webContents.capturePage).toHaveBeenCalledOnce()
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

  it('does not dedupe content zoom changes that round to the same displayed percentage', async () => {
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

    vi.mocked(view.webContents.getZoomFactor).mockReturnValue(1.101)
    const first = panel.capturePanelSnapshot(win, scopeId)
    vi.mocked(view.webContents.getZoomFactor).mockReturnValue(1.104)
    const second = panel.capturePanelSnapshot(win, scopeId)

    expect(view.webContents.capturePage).toHaveBeenCalledOnce()
    pendingCaptures[0]?.(image)
    await expect(first).resolves.toBeNull()
    await vi.waitFor(() => expect(view.webContents.capturePage).toHaveBeenCalledTimes(2))

    pendingCaptures[1]?.(image)
    await expect(second).resolves.toMatchObject({ zoomPercent: 121 })
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

  it('requests a fresh compositor frame when a browser view is attached or revealed', () => {
    const { win, view } = showPanel(panel)

    expect(view.webContents.invalidate).toHaveBeenCalledOnce()

    panel.setPanelBounds(null, win)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(view.webContents.invalidate).toHaveBeenCalledOnce()

    panel.setPanelBounds(PANEL_RECT, win)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.webContents.invalidate).toHaveBeenCalledTimes(2)

    panel.setPanelBounds(PANEL_RECT, win)
    expect(view.webContents.invalidate).toHaveBeenCalledTimes(2)
  })

  it('reports the exact applied native rectangle in renderer viewport coordinates', async () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(win.webContents.getZoomFactor).mockReturnValue(1.25)
    vi.mocked(win.getContentSize).mockReturnValue([2_000, 1_400])

    panel.setPanelBounds({ x: 100, y: 50, width: 801, height: 601 }, win)

    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 125,
      y: 63,
      width: 1001,
      height: 751,
    })
    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.toMatchObject({
      viewportBounds: { x: 100, y: 50.4, width: 800.8, height: 600.8 },
    })
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

  it('force-hides the native page without a captured replacement frame', () => {
    const { win, view } = showPanel(panel)
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(view.setVisible).mockClear()

    expect(panel.setPanelOccluded(true, win, scopeId)).toBe(false)
    expect(view.setVisible).not.toHaveBeenCalled()

    expect(panel.setPanelOccluded(true, win, scopeId, true)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('applies a forced hide before the panel reports its first bounds', () => {
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

    expect(panel.setPanelOccluded(true, win, 'chat-test')).toBe(false)
    expect(panel.setPanelOccluded(true, win, 'chat-test', true)).toBe(true)

    panel.setPanelBounds(PANEL_RECT, win)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('transfers a hidden lease to a focused window before its bounds arrive', () => {
    const { win, view } = showPanel(panel)
    const other = new BrowserWindow()
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(other.isFocused).mockReturnValue(true)
    vi.mocked(view.setVisible).mockClear()

    expect(panel.setPanelOccluded(true, other, scopeId)).toBe(false)
    expect(panel.setPanelOccluded(true, other, scopeId, true)).toBe(true)
    expect(win.contentView.removeChildView).toHaveBeenCalledWith(view)

    panel.setPanelBounds(PANEL_RECT, other)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(panel.setPanelOccluded(false, other, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(panel.setPanelOccluded(false, win, scopeId)).toBe(true)
  })

  it('acknowledges forced occlusion in an unfocused window that has no local native view', () => {
    const { win, view } = showPanel(panel)
    const other = new BrowserWindow()
    const scopeId = panel.getActivePanelScopeId()
    vi.mocked(other.isFocused).mockReturnValue(false)
    vi.mocked(view.setVisible).mockClear()

    expect(panel.setPanelOccluded(true, other, scopeId, true)).toBe(true)
    expect(view.setVisible).not.toHaveBeenCalled()
    expect(panel.setPanelOccluded(false, other, scopeId)).toBe(true)
    expect(view.setVisible).not.toHaveBeenCalled()
    expect(panel.setPanelOccluded(false, win, scopeId)).toBe(true)
  })

  it('acknowledges cross-scope modal leases only for a window without the singleton view', () => {
    const { win, view } = showPanel(panel)
    const other = new BrowserWindow()
    vi.mocked(other.isFocused).mockReturnValue(false)
    vi.mocked(view.setVisible).mockClear()

    expect(panel.setPanelOccluded(true, other, 'chat-in-other-window', true)).toBe(true)
    expect(panel.setPanelOccluded(false, other, 'chat-in-other-window')).toBe(true)
    expect(view.setVisible).not.toHaveBeenCalled()

    vi.mocked(other.isFocused).mockReturnValue(true)
    expect(panel.setPanelOccluded(true, other, 'focused-other-chat', true)).toBe(false)

    // A stale scope from the real owner must never mutate or falsely
    // acknowledge the currently hosted native surface.
    expect(panel.setPanelOccluded(true, win, 'stale-owner-chat', true)).toBe(false)
    expect(panel.setPanelOccluded(false, win, 'stale-owner-chat')).toBe(false)
    expect(view.setVisible).not.toHaveBeenCalled()
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

  it('lets a displaced window retire its snapshot without revealing the current modal lease', async () => {
    const { win, view } = showPanel(panel)
    const other = new BrowserWindow()
    const scopeId = panel.getActivePanelScopeId()

    await expect(panel.capturePanelSnapshot(win, scopeId)).resolves.not.toBeNull()
    expect(panel.setPanelOccluded(true, win, scopeId)).toBe(true)

    vi.mocked(other.isFocused).mockReturnValue(true)
    expect(panel.setPanelOccluded(true, other, scopeId, true)).toBe(true)
    panel.setPanelBounds(PANEL_RECT, other)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)

    expect(panel.setPanelOccluded(false, win, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(panel.setPanelOccluded(false, other, scopeId)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('lets the prior scope retire after a focused window establishes the next hidden lease', () => {
    const { win, view } = showPanel(panel)
    const other = new BrowserWindow()
    const previousScope = panel.getActivePanelScopeId()
    const nextScope = 'chat-in-focused-window'
    vi.mocked(other.isFocused).mockReturnValue(true)

    panel.activatePanelScope(nextScope)
    expect(panel.setPanelOccluded(true, other, nextScope, true)).toBe(true)
    panel.setPanelBounds(PANEL_RECT, other, undefined, nextScope)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)

    expect(panel.setPanelOccluded(false, win, previousScope)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(panel.setPanelOccluded(false, other, nextScope)).toBe(true)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
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
    expect(panel.setPanelOccluded(true, win, 'some-other-chat', true)).toBe(false)
    expect(view.setVisible).not.toHaveBeenCalled()
  })
})
