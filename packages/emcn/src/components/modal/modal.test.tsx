/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useState } from 'react'
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

function _CustomTakeover() {
  const ready = useNativeSurfaceOcclusionReady(true, 'takeover')
  return <div data-testid='takeover' data-ready={ready ? 'true' : 'false'} />
}

function _TriggeredModal() {
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
})
