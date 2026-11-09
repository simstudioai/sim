/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { ToastProvider } from '@sim/emcn-legacy'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/app/_shell/toast-sink'
import { toast } from '@/lib/toast/sink'

describe('the site toast sink', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    stubResizeObserver()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<ToastProvider />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('routes a shared module toast to the site toaster, whose action runs its handler', async () => {
    const onRetry = vi.fn()
    await act(async () => {
      toast.error('Could not save', { action: { label: 'Retry', onClick: onRetry } })
    })
    const action = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry'
    )
    if (!action) throw new Error('The site toaster rendered no action for the toast')
    await act(async () => action.click())
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('dismisses by the id the site toaster returned and reports the dismissal', async () => {
    const onDismiss = vi.fn()
    let id = ''
    await act(async () => {
      id = toast({ message: 'Importing', duration: 0, onDismiss })
    })
    expect(id).not.toBe('')
    await act(async () => {
      toast.dismiss(id)
    })
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
