/**
 * @vitest-environment jsdom
 *
 * An upload keeps sending after the page that started it unmounts, so closing the tab must ask
 * first. Failure modes: no prompt while an upload sends, and a prompt that outlives the upload.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadGuard } from '@/platform/lib/data/upload-guard'
import { useInFlightUploadsStore } from '@/stores/in-flight-uploads/store'

let root: Root

function unloadIsHeld() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('the workspace upload guard', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(document.createElement('div'))
    act(() => root.render(<UploadGuard />))
  })

  afterEach(() => {
    act(() => root.unmount())
    useInFlightUploadsStore.setState({ count: 0 })
  })

  it('asks before unloading while an upload sends, and stops once it settles', () => {
    expect(unloadIsHeld()).toBe(false)

    let release = () => {}
    act(() => {
      release = useInFlightUploadsStore.getState().begin()
    })
    expect(unloadIsHeld()).toBe(true)

    act(() => release())
    expect(unloadIsHeld()).toBe(false)
  })
})
