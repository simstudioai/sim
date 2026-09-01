/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useState } from 'react'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalTrigger,
  NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
  type NativeSurfaceOcclusionPrepareDetail,
  useNativeSurfaceOcclusionReady,
} from './modal'

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/home',
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

function renderedModalLayers() {
  const overlay = document.querySelector<HTMLElement>('[data-native-surface-occlusion="modal"]')
  const contentLayer = document.querySelector<HTMLElement>(
    '[data-native-surface-modal-content-layer]'
  )
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!overlay || !contentLayer) throw new Error('Modal shell did not render')
  return { contentLayer, dialog, overlay }
}

function FullModal({ open = true }: { open?: boolean }) {
  return (
    <Modal open={open}>
      <ModalContent srTitle='Test modal'>
        <input aria-label='Modal field' />
      </ModalContent>
    </Modal>
  )
}

function CustomTakeover() {
  const ready = useNativeSurfaceOcclusionReady(true, 'takeover')
  return <div data-testid='takeover' data-ready={ready ? 'true' : 'false'} />
}

function TriggeredModal() {
  const [open, setOpen] = useState(false)
  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <button type='button' data-testid='modal-trigger'>
          Open
        </button>
      </ModalTrigger>
      <ModalContent srTitle='Triggered modal'>
        <input aria-label='Triggered modal field' />
        <ModalClose asChild>
          <button type='button' data-testid='modal-close'>
            Close
          </button>
        </ModalClose>
      </ModalContent>
    </Modal>
  )
}

describe('native-surface modal preparation', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    document.body.replaceChildren()
    document.body.removeAttribute('style')
    vi.restoreAllMocks()
  })

  it('keeps both the scrim and content hidden until every registered preparation settles', async () => {
    vi.useFakeTimers()
    const backgroundInput = document.createElement('input')
    const backgroundKeyDown = vi.fn()
    backgroundInput.addEventListener('keydown', backgroundKeyDown)
    document.body.appendChild(backgroundInput)
    backgroundInput.focus()
    let finishFirstPreparation: (() => void) | undefined
    const firstPreparation = new Promise<void>((resolve) => {
      finishFirstPreparation = resolve
    })
    let finishSecondPreparation: (() => void) | undefined
    const secondPreparation = new Promise<void>((resolve) => {
      finishSecondPreparation = resolve
    })
    const listener = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<NativeSurfaceOcclusionPrepareDetail>).detail
      detail.waitUntil(firstPreparation)
      detail.waitUntil(secondPreparation)
    })
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, listener, { once: true })

    mount(<FullModal />)

    const layers = renderedModalLayers()
    expect(listener).toHaveBeenCalledOnce()
    expect(layers.overlay.style.visibility).toBe('hidden')
    expect(layers.overlay.className).toContain('data-[state=open]:[animation-play-state:paused]')
    expect(layers.contentLayer.className).toContain('pointer-events-auto')
    expect(layers.dialog?.style.visibility).toBe('hidden')
    expect(layers.dialog?.className).toContain('data-[state=open]:[animation-play-state:paused]')
    expect(layers.dialog?.dataset.nativeSurfaceOcclusion).toBe('modal')
    expect(document.activeElement).toBe(backgroundInput)
    const blockedKey = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'x',
    })
    backgroundInput.dispatchEvent(blockedKey)
    expect(blockedKey.defaultPrevented).toBe(true)
    expect(backgroundKeyDown).not.toHaveBeenCalled()

    await act(async () => {
      finishFirstPreparation?.()
      await firstPreparation
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(layers.overlay.style.visibility).toBe('hidden')
    expect(layers.dialog?.style.visibility).toBe('hidden')

    await act(async () => {
      finishSecondPreparation?.()
      await secondPreparation
    })

    const readyLayers = renderedModalLayers()
    expect(readyLayers.overlay.style.visibility).not.toBe('hidden')
    expect(readyLayers.overlay.className).not.toContain(
      'data-[state=open]:[animation-play-state:paused]'
    )
    expect(readyLayers.contentLayer.className).toContain('pointer-events-none')
    expect(readyLayers.dialog).not.toBeNull()
    expect(readyLayers.dialog?.style.visibility).not.toBe('hidden')
    expect(document.activeElement).toBe(
      document.querySelector<HTMLInputElement>('[aria-label="Modal field"]')
    )
  })

  it('releases synchronously in its layout effect when no native surface listener exists', () => {
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame')
    const backgroundInput = document.createElement('input')
    const backgroundKeyDown = vi.fn()
    backgroundInput.addEventListener('keydown', backgroundKeyDown)
    document.body.appendChild(backgroundInput)

    mount(<FullModal />)

    const layers = renderedModalLayers()
    expect(layers.overlay.style.visibility).not.toBe('hidden')
    expect(layers.overlay.style.animationPlayState).not.toBe('paused')
    expect(layers.contentLayer.className).toContain('pointer-events-none')
    expect(layers.dialog).not.toBeNull()
    expect(layers.dialog?.style.visibility).not.toBe('hidden')
    expect(document.activeElement).toBe(
      document.querySelector<HTMLInputElement>('[aria-label="Modal field"]')
    )
    expect(animationFrame).not.toHaveBeenCalled()
    const unblockedKey = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'x',
    })
    backgroundInput.dispatchEvent(unblockedKey)
    expect(unblockedKey.defaultPrevented).toBe(false)
    expect(backgroundKeyDown).toHaveBeenCalledOnce()
  })

  it('preserves the original consumer autofocus callback when no listener claims the barrier', () => {
    let autofocusCalls = 0

    mount(
      <Modal open>
        <ModalContent
          srTitle='Custom focus modal'
          onOpenAutoFocus={(event) => {
            autofocusCalls++
            event.preventDefault()
          }}
        >
          <input aria-label='Should not be focused' />
        </ModalContent>
      </Modal>
    )

    expect(autofocusCalls).toBe(1)
    expect(document.activeElement).not.toBe(
      document.querySelector<HTMLInputElement>('[aria-label="Should not be focused"]')
    )
  })

  it('restores a renderer trigger after a claimed modal closes', async () => {
    let finishPreparation: (() => void) | undefined
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve
    })
    window.addEventListener(
      NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
      (event) => {
        const detail = (event as CustomEvent<NativeSurfaceOcclusionPrepareDetail>).detail
        detail.waitUntil(preparation)
      },
      { once: true }
    )

    mount(<TriggeredModal />)
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="modal-trigger"]')
    if (!trigger) throw new Error('Modal trigger did not render')
    act(() => {
      trigger.focus()
      trigger.click()
    })

    expect(document.activeElement).toBe(trigger)

    await act(async () => {
      finishPreparation?.()
      await preparation
    })
    expect(document.activeElement).toBe(
      document.querySelector<HTMLInputElement>('[aria-label="Triggered modal field"]')
    )

    const close = document.querySelector<HTMLButtonElement>('[data-testid="modal-close"]')
    if (!close) throw new Error('Modal close button did not render')
    await act(async () => {
      close.click()
      await sleep(20)
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('fails closed when a registered preparation rejects', async () => {
    const backgroundInput = document.createElement('input')
    const backgroundKeyDown = vi.fn()
    backgroundInput.addEventListener('keydown', backgroundKeyDown)
    document.body.appendChild(backgroundInput)
    let failPreparation: ((reason: Error) => void) | undefined
    const preparation = new Promise<void>((_, reject) => {
      failPreparation = reject
    })
    const listener = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<NativeSurfaceOcclusionPrepareDetail>).detail
      detail.waitUntil(preparation)
    })
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, listener, { once: true })

    mount(<FullModal />)
    const layers = renderedModalLayers()
    expect(document.querySelector('[data-native-surface-interaction-sentinel]')).not.toBeNull()

    await act(async () => {
      failPreparation?.(new Error('native hide failed'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listener).toHaveBeenCalledOnce()
    expect(layers.overlay.style.visibility).toBe('hidden')
    expect(layers.overlay.className).toContain('data-[state=open]:[animation-play-state:paused]')
    expect(layers.contentLayer.className).toContain('pointer-events-auto')
    expect(layers.dialog?.style.visibility).toBe('hidden')
    expect(layers.dialog?.className).toContain('data-[state=open]:[animation-play-state:paused]')

    await act(async () => {
      root?.render(<FullModal open={false} />)
      await Promise.resolve()
    })
    expect(document.querySelector('[data-native-surface-interaction-sentinel]')).toBeNull()
    const unblockedKey = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'x',
    })
    backgroundInput.dispatchEvent(unblockedKey)
    expect(unblockedKey.defaultPrevented).toBe(false)
    expect(backgroundKeyDown).toHaveBeenCalledOnce()
  })

  it('gates custom full-screen takeovers with the same preparation contract', async () => {
    let finishPreparation: (() => void) | undefined
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve
    })
    const listener = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<NativeSurfaceOcclusionPrepareDetail>).detail
      expect(detail.kind).toBe('takeover')
      detail.waitUntil(preparation)
    })
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, listener, { once: true })

    mount(<CustomTakeover />)

    const takeover = document.querySelector<HTMLElement>('[data-testid="takeover"]')
    expect(listener).toHaveBeenCalledOnce()
    expect(takeover?.dataset.ready).toBe('false')

    await act(async () => {
      finishPreparation?.()
      await preparation
    })

    expect(takeover?.dataset.ready).toBe('true')
  })
})
