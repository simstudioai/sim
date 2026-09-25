/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import {
  NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
  type NativeSurfaceOcclusionPrepareDetail,
} from '@sim/emcn'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  captureBrowserPanelSnapshot,
  setBrowserPanelOccluded,
  supportsAtomicBrowserPanelOcclusion,
} = vi.hoisted(() => ({
  captureBrowserPanelSnapshot: vi.fn(),
  setBrowserPanelOccluded: vi.fn(),
  supportsAtomicBrowserPanelOcclusion: vi.fn(),
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  captureBrowserPanelSnapshot,
  setBrowserPanelOccluded,
  supportsAtomicBrowserPanelOcclusion,
}))

import {
  createBrowserPanelGeometryOcclusionLease,
  snapshotMatchesHost,
  useBrowserPanelOcclusion,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion'

const SNAPSHOT = {
  dataUrl: 'data:image/png;base64,c2lt',
  scopeId: 'chat-1',
  tabId: 'tab-1',
  viewportBounds: { x: 500, y: 64, width: 800, height: 700 },
  zoomPercent: 100,
}

type OcclusionResult = ReturnType<typeof useBrowserPanelOcclusion>

interface HookHarness {
  result: () => OcclusionResult
  setPanelVisible: (visible: boolean) => void
  unmount: () => void
}

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null
let nextAnimationFrameId = 1
const animationFrames = new Map<number, FrameRequestCallback>()

function renderOcclusionHook(panelVisible = true): HookHarness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  activeRoot = root
  activeContainer = container
  let latest: OcclusionResult | undefined

  function Probe({ visible }: { visible: boolean }) {
    latest = useBrowserPanelOcclusion(
      'chat-1',
      'tab-1',
      visible,
      () => new DOMRect(500, 64, 800, 700)
    )
    return null
  }

  act(() => root.render(createElement(Probe, { visible: panelVisible })))

  return {
    result: () => {
      if (!latest) throw new Error('Occlusion hook did not render')
      return latest
    },
    setPanelVisible: (visible) => {
      act(() => root.render(createElement(Probe, { visible })))
    },
    unmount: () => {
      if (activeRoot !== root) return
      act(() => root.unmount())
      activeRoot = null
      container.remove()
      activeContainer = null
    },
  }
}

async function flushOcclusionLifecycle(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await act(async () => {
      await Promise.resolve()
      await sleep(0)
    })

    const queuedFrames = [...animationFrames.entries()]
    animationFrames.clear()
    if (queuedFrames.length > 0) {
      act(() => {
        for (const [, callback] of queuedFrames) callback(performance.now())
      })
    }
  }
}

function addModalOverlay(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-native-surface-occlusion', 'modal')
  document.body.appendChild(overlay)
  return overlay
}

describe('browser panel geometry occlusion lease', () => {
  it('rolls back an in-flight hide when its marker disappears before Electron responds', async () => {
    let finishHide: ((hidden: boolean) => void) | undefined
    const hide = new Promise<boolean>((resolve) => {
      finishHide = resolve
    })
    const apply = vi.fn((occluded: boolean) => (occluded ? hide : Promise.resolve(true)))
    const lease = createBrowserPanelGeometryOcclusionLease(apply)

    const hidden = lease.setDesired(true)
    await Promise.resolve()
    expect(apply).toHaveBeenCalledWith(true)

    const revealed = lease.setDesired(false)
    finishHide?.(true)

    await expect(hidden).resolves.toBe(false)
    await expect(revealed).resolves.toBe(true)
    expect(apply.mock.calls.map(([occluded]) => occluded)).toEqual([true, false])
    expect(lease.isOccluded()).toBe(false)
    expect(lease.isTransitioning()).toBe(false)
  })

  it('starts a reveal when desired state changes as the prior hide promise settles', async () => {
    const apply = vi.fn(async () => true)
    const lease = createBrowserPanelGeometryOcclusionLease(apply)

    const hidden = lease.setDesired(true)
    await Promise.resolve()
    await Promise.resolve()
    const revealed = lease.setDesired(false)

    await expect(hidden).resolves.toBe(false)
    await expect(revealed).resolves.toBe(true)
    expect(apply.mock.calls.map(([occluded]) => occluded)).toEqual([true, false])
    expect(lease.isOccluded()).toBe(false)
    expect(lease.isTransitioning()).toBe(false)
  })
})

describe('useBrowserPanelOcclusion modal lifecycle', () => {
  beforeEach(() => {
    nextAnimationFrameId = 1
    animationFrames.clear()
    captureBrowserPanelSnapshot.mockResolvedValue(SNAPSHOT)
    setBrowserPanelOccluded.mockResolvedValue(true)
    supportsAtomicBrowserPanelOcclusion.mockReturnValue(true)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextAnimationFrameId++
      animationFrames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      animationFrames.delete(handle)
    })
    class DecodableImage {
      src = ''

      async decode(): Promise<void> {}
    }
    vi.stubGlobal('Image', DecodableImage)
  })

  afterEach(() => {
    if (activeRoot) act(() => activeRoot?.unmount())
    activeRoot = null
    activeContainer?.remove()
    activeContainer = null
    animationFrames.clear()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects the gate instead of revealing through a failed forced hide', async () => {
    captureBrowserPanelSnapshot.mockResolvedValue(null)
    setBrowserPanelOccluded.mockResolvedValue(false)
    const hook = renderOcclusionHook()
    let preparation: Promise<unknown> | undefined

    act(() => {
      window.dispatchEvent(
        new CustomEvent<NativeSurfaceOcclusionPrepareDetail>(
          NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
          {
            detail: {
              kind: 'modal',
              waitUntil: (pending) => {
                preparation = pending
              },
            },
          }
        )
      )
    })

    const rejection = expect(preparation).rejects.toThrow(
      'The native browser surface could not be occluded'
    )
    await flushOcclusionLifecycle()
    await rejection
    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(true, 'chat-1', true)
    hook.unmount()
  })

  it('keeps simultaneous modal gates waiting for the latest hide transition', async () => {
    const hook = renderOcclusionHook()
    let finishNativeHide: ((hidden: boolean) => void) | undefined
    const nativeHide = new Promise<boolean>((resolve) => {
      finishNativeHide = resolve
    })
    setBrowserPanelOccluded.mockImplementation((occluded: boolean) =>
      occluded ? nativeHide : Promise.resolve(true)
    )
    const preparations: Promise<unknown>[] = []

    act(() => {
      for (let index = 0; index < 2; index++) {
        window.dispatchEvent(
          new CustomEvent<NativeSurfaceOcclusionPrepareDetail>(
            NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
            {
              detail: {
                kind: 'modal',
                waitUntil: (preparation) => preparations.push(preparation),
              },
            }
          )
        )
      }
    })

    expect(preparations).toHaveLength(2)
    const settled = [false, false]
    preparations.forEach((preparation, index) => {
      void preparation.then(() => {
        settled[index] = true
      })
    })

    await flushOcclusionLifecycle()

    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(settled).toEqual([false, false])

    await act(async () => {
      finishNativeHide?.(true)
      await Promise.all(preparations)
    })
    expect(settled).toEqual([true, true])
    hook.unmount()
  })

  it('keeps the browser hidden until the last nested modal finishes exiting', async () => {
    const firstModal = addModalOverlay()
    const hook = renderOcclusionHook()
    await flushOcclusionLifecycle()

    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(1)
    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(true, 'chat-1')

    const secondModal = document.createElement('div')
    secondModal.setAttribute('data-native-surface-occlusion', 'modal')
    act(() => {
      document.body.appendChild(secondModal)
      firstModal.remove()
    })
    await flushOcclusionLifecycle()

    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(1)
    expect(hook.result().snapshotLayer).toBe('modal')

    act(() => secondModal.remove())
    await flushOcclusionLifecycle()

    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(2)
    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(false, 'chat-1')
    expect(hook.result().snapshot).toBeNull()
    hook.unmount()
  })

  it('replaces the native page only while a moving tooltip overlaps it', async () => {
    let nativeVisible = true
    setBrowserPanelOccluded.mockImplementation(async (hidden: boolean) => {
      nativeVisible = !hidden
      return true
    })
    const hook = renderOcclusionHook()
    const tooltip = document.createElement('div')
    tooltip.setAttribute('data-native-surface-overlay', '')
    let bounds = new DOMRect(100, 100, 200, 60)
    tooltip.getBoundingClientRect = () => bounds
    act(() => document.body.appendChild(tooltip))
    await flushOcclusionLifecycle()
    expect(nativeVisible).toBe(true)
    expect(hook.result().snapshot).toBeNull()

    bounds = new DOMRect(450, 100, 200, 60)
    await flushOcclusionLifecycle()
    expect(nativeVisible).toBe(false)
    expect(hook.result().snapshotLayer).toBe('popover')

    bounds = new DOMRect(100, 100, 200, 60)
    await flushOcclusionLifecycle()
    expect(nativeVisible).toBe(true)
    expect(hook.result().snapshot).toBeNull()
    hook.unmount()
  })

  it('retains overlapping menus through modal handoff and releases after the last overlay', async () => {
    let nativeVisible = true
    setBrowserPanelOccluded.mockImplementation(async (hidden: boolean) => {
      nativeVisible = !hidden
      return true
    })
    const hook = renderOcclusionHook()
    const menu = document.createElement('div')
    menu.setAttribute('data-native-surface-overlay', '')
    menu.getBoundingClientRect = () => new DOMRect(450, 100, 200, 60)
    act(() => document.body.appendChild(menu))
    await flushOcclusionLifecycle()
    expect(nativeVisible).toBe(false)

    const modal = addModalOverlay()
    await flushOcclusionLifecycle()
    expect(hook.result().snapshotLayer).toBe('modal')
    act(() => modal.remove())
    await flushOcclusionLifecycle()
    expect(nativeVisible).toBe(false)
    expect(hook.result().snapshotLayer).toBe('popover')

    act(() => menu.remove())
    await flushOcclusionLifecycle()
    expect(nativeVisible).toBe(true)
    expect(hook.result().snapshot).toBeNull()
    hook.unmount()
  })

  it('does not hide the page when an overlapping tooltip disappears during capture', async () => {
    let finishCapture: ((frame: typeof SNAPSHOT) => void) | undefined
    captureBrowserPanelSnapshot.mockImplementation(
      () =>
        new Promise<typeof SNAPSHOT>((resolve) => {
          finishCapture = resolve
        })
    )
    let nativeVisible = true
    setBrowserPanelOccluded.mockImplementation(async (hidden: boolean) => {
      nativeVisible = !hidden
      return true
    })
    const hook = renderOcclusionHook()
    const tooltip = document.createElement('div')
    tooltip.setAttribute('data-native-surface-overlay', '')
    tooltip.getBoundingClientRect = () => new DOMRect(450, 100, 200, 60)
    act(() => document.body.appendChild(tooltip))
    await flushOcclusionLifecycle()
    expect(finishCapture).toBeTypeOf('function')

    act(() => tooltip.remove())
    await flushOcclusionLifecycle()
    finishCapture?.(SNAPSHOT)
    await flushOcclusionLifecycle()
    expect(nativeVisible).toBe(true)
    expect(hook.result().snapshot).toBeNull()
    hook.unmount()
  })
})

describe('snapshotMatchesHost', () => {
  const rect = (x: number, y: number, width: number, height: number) =>
    ({ x, y, width, height }) as DOMRect

  it('rejects a capture taken before a scroll lock reflowed the panel', () => {
    // Modal scroll lock removes the scrollbar: the host widens by 15px, so the
    // pre-lock capture would paint misaligned — the flash this guards.
    expect(
      snapshotMatchesHost(
        { viewportBounds: { x: 10, y: 20, width: 800, height: 600 } },
        rect(10, 20, 815, 600)
      )
    ).toBe(false)
  })
})
