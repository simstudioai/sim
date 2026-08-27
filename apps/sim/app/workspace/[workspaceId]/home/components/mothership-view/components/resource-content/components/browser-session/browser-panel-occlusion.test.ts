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
  hasNativeSurfaceOcclusion,
  NATIVE_SURFACE_OCCLUSION_SELECTOR,
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
    latest = useBrowserPanelOcclusion('chat-1', 'tab-1', visible)
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

describe('hasNativeSurfaceOcclusion', () => {
  it('recognizes only the dedicated full-screen modal marker', () => {
    const root = document.createElement('section')
    const genericOverlay = document.createElement('div')
    genericOverlay.setAttribute('data-native-surface-overlay', '')
    root.appendChild(genericOverlay)

    expect(NATIVE_SURFACE_OCCLUSION_SELECTOR).toBe('[data-native-surface-occlusion]')
    expect(hasNativeSurfaceOcclusion(root)).toBe(false)

    const modalOverlay = document.createElement('div')
    modalOverlay.setAttribute('data-native-surface-occlusion', 'modal')
    genericOverlay.appendChild(modalOverlay)

    expect(hasNativeSurfaceOcclusion(root)).toBe(true)
  })
})

describe('useBrowserPanelOcclusion modal lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('ignores generic native-surface overlays but captures a dedicated modal', async () => {
    const genericOverlay = document.createElement('div')
    genericOverlay.setAttribute('data-native-surface-overlay', '')
    document.body.appendChild(genericOverlay)

    const hook = renderOcclusionHook()
    await flushOcclusionLifecycle()
    expect(captureBrowserPanelSnapshot).not.toHaveBeenCalled()

    act(() => {
      addModalOverlay()
    })
    await flushOcclusionLifecycle()

    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(setBrowserPanelOccluded).toHaveBeenCalledWith(true, 'chat-1')
    expect(hook.result().snapshot).toEqual(SNAPSHOT)
    expect(hook.result().snapshotLayer).toBe('modal')
    expect(hook.result().activeOverlay).toBeNull()
    hook.unmount()
  })

  it('tracks a custom modal that toggles its marker while remaining mounted', async () => {
    const overlay = document.createElement('div')
    document.body.appendChild(overlay)
    const hook = renderOcclusionHook()

    act(() => overlay.setAttribute('data-native-surface-occlusion', 'modal'))
    await flushOcclusionLifecycle()

    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(hook.result().snapshotLayer).toBe('modal')
    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(true, 'chat-1')

    act(() => overlay.removeAttribute('data-native-surface-occlusion'))
    await flushOcclusionLifecycle()

    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(false, 'chat-1')
    expect(hook.result().snapshot).toBeNull()
    hook.unmount()
  })

  it('registers capture, paint, and native hide with the modal pre-paint gate', async () => {
    const hook = renderOcclusionHook()
    let finishNativeHide: ((hidden: boolean) => void) | undefined
    const nativeHide = new Promise<boolean>((resolve) => {
      finishNativeHide = resolve
    })
    setBrowserPanelOccluded.mockImplementation((occluded: boolean) =>
      occluded ? nativeHide : Promise.resolve(true)
    )
    let preparation: Promise<unknown> | undefined
    const waitUntil = vi.fn((pending: Promise<unknown>) => {
      preparation = pending
    })

    act(() => {
      window.dispatchEvent(
        new CustomEvent<NativeSurfaceOcclusionPrepareDetail>(
          NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
          {
            detail: { kind: 'modal', waitUntil },
          }
        )
      )
    })

    expect(waitUntil).toHaveBeenCalledOnce()
    expect(preparation).toBeInstanceOf(Promise)
    const registeredPreparation = preparation as Promise<unknown>
    let preparationSettled = false
    void registeredPreparation.then(() => {
      preparationSettled = true
    })

    await flushOcclusionLifecycle()

    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(hook.result().snapshot).toEqual(SNAPSHOT)
    expect(hook.result().snapshotLayer).toBe('modal')
    expect(setBrowserPanelOccluded).toHaveBeenCalledWith(true, 'chat-1')
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2)
    expect(preparationSettled).toBe(false)
    expect(captureBrowserPanelSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      setBrowserPanelOccluded.mock.invocationCallOrder[0]
    )

    await act(async () => {
      finishNativeHide?.(true)
      await registeredPreparation
    })
    expect(preparationSettled).toBe(true)
    await expect(registeredPreparation).resolves.toBeUndefined()
    hook.unmount()
  })

  it('does not claim the shared gate when no native browser surface is eligible', () => {
    const hook = renderOcclusionHook(false)
    const waitUntil = vi.fn()

    act(() => {
      window.dispatchEvent(
        new CustomEvent<NativeSurfaceOcclusionPrepareDetail>(
          NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
          {
            detail: { kind: 'modal', waitUntil },
          }
        )
      )
    })

    expect(waitUntil).not.toHaveBeenCalled()
    expect(captureBrowserPanelSnapshot).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('leaves older shells on their original non-blocking observer path', () => {
    supportsAtomicBrowserPanelOcclusion.mockReturnValue(false)
    const hook = renderOcclusionHook()
    const waitUntil = vi.fn()

    act(() => {
      window.dispatchEvent(
        new CustomEvent<NativeSurfaceOcclusionPrepareDetail>(
          NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
          {
            detail: { kind: 'modal', waitUntil },
          }
        )
      )
    })

    expect(waitUntil).not.toHaveBeenCalled()
    expect(captureBrowserPanelSnapshot).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('uses forced hiding only after exact modal swaps fail', async () => {
    const hook = renderOcclusionHook()
    setBrowserPanelOccluded.mockImplementation(
      (occluded: boolean, _scopeId: string, force?: boolean) =>
        Promise.resolve(!occluded || force === true)
    )
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

    await flushOcclusionLifecycle()
    await expect(preparation).resolves.toBeUndefined()
    expect(setBrowserPanelOccluded).toHaveBeenCalledWith(true, 'chat-1', true)
    expect(hook.result().snapshotLayer).toBe('modal')
    hook.unmount()
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

  it('retains the replacement if revealing the native surface is refused', async () => {
    const modal = addModalOverlay()
    const hook = renderOcclusionHook()
    await flushOcclusionLifecycle()
    expect(hook.result().snapshot).toEqual(SNAPSHOT)

    setBrowserPanelOccluded.mockResolvedValue(false)
    act(() => modal.remove())
    await flushOcclusionLifecycle()

    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(false, 'chat-1')
    expect(hook.result().snapshot).toEqual(SNAPSHOT)
    hook.unmount()
  })

  it('reuses a painted popover frame for a modal without revealing the native view between them', async () => {
    const fallback = vi.fn()
    const onOwnershipLost = vi.fn()
    const hook = renderOcclusionHook()

    act(() => {
      void hook.result().requestOverlay('resources', fallback, onOwnershipLost)
    })
    await flushOcclusionLifecycle()

    expect(hook.result().activeOverlay).toBe('resources')
    expect(hook.result().snapshotLayer).toBe('popover')
    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(1)
    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(true, 'chat-1')

    let modal: HTMLDivElement | null = null
    act(() => {
      modal = addModalOverlay()
    })
    await flushOcclusionLifecycle()

    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(1)
    expect(hook.result().activeOverlay).toBeNull()
    expect(hook.result().snapshotLayer).toBe('modal')
    expect(onOwnershipLost).toHaveBeenCalledOnce()

    await act(async () => {
      await hook.result().closeOverlay('resources')
    })
    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(1)

    act(() => modal?.remove())
    await flushOcclusionLifecycle()

    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(2)
    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(false, 'chat-1')
    expect(fallback).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('replaces one popover with another without revealing or recapturing the native view', async () => {
    const firstFallback = vi.fn()
    const secondFallback = vi.fn()
    const firstOwnershipLost = vi.fn()
    const hook = renderOcclusionHook()
    let firstRequest!: Promise<boolean>
    let secondRequest!: Promise<boolean>

    act(() => {
      firstRequest = hook.result().requestOverlay('resources', firstFallback, firstOwnershipLost)
    })
    await flushOcclusionLifecycle()
    expect(await firstRequest).toBe(true)
    expect(hook.result().activeOverlay).toBe('resources')

    act(() => {
      secondRequest = hook.result().requestOverlay('tab', secondFallback)
    })
    await flushOcclusionLifecycle()

    expect(await secondRequest).toBe(true)
    expect(hook.result().activeOverlay).toBe('tab')
    expect(captureBrowserPanelSnapshot).toHaveBeenCalledOnce()
    expect(setBrowserPanelOccluded).toHaveBeenCalledTimes(1)
    expect(firstOwnershipLost).toHaveBeenCalledOnce()
    expect(firstFallback).not.toHaveBeenCalled()
    expect(secondFallback).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('retires an active popover and replacement when the Browser becomes ineligible', async () => {
    const hook = renderOcclusionHook()
    act(() => {
      void hook.result().requestOverlay('toolbar', vi.fn())
    })
    await flushOcclusionLifecycle()
    expect(hook.result().activeOverlay).toBe('toolbar')
    expect(hook.result().snapshot).toEqual(SNAPSHOT)

    hook.setPanelVisible(false)
    await flushOcclusionLifecycle()

    expect(hook.result().activeOverlay).toBeNull()
    expect(hook.result().snapshot).toBeNull()
    expect(setBrowserPanelOccluded).toHaveBeenLastCalledWith(false, 'chat-1')
    hook.unmount()
  })
})

describe('snapshotMatchesHost', () => {
  const rect = (x: number, y: number, width: number, height: number) =>
    ({ x, y, width, height }) as DOMRect

  it('accepts a capture that still describes the host rect', () => {
    expect(
      snapshotMatchesHost(
        { viewportBounds: { x: 10, y: 20, width: 800, height: 600 } },
        rect(10, 20, 800, 600)
      )
    ).toBe(true)
  })

  it('tolerates sub-pixel drift from rounding', () => {
    expect(
      snapshotMatchesHost(
        { viewportBounds: { x: 10, y: 20, width: 800, height: 600 } },
        rect(10.4, 19.6, 800.5, 599.5)
      )
    ).toBe(true)
  })

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

  it('accepts captures with no viewport bounds (host-tracking fallback style)', () => {
    expect(snapshotMatchesHost({ viewportBounds: undefined }, rect(0, 0, 100, 100))).toBe(true)
    expect(
      snapshotMatchesHost({ viewportBounds: { x: 0, y: 0, width: 10, height: 10 } }, null)
    ).toBe(true)
  })
})
