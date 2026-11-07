/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { ToastProvider } from '@sim/emcn-legacy'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/app/o/[organizationId]/components/toast-sink'
import { toast } from '@/platform/shared/toast'

describe('the organization toast sink', () => {
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

  it('shows a view toast on the host toaster with its description and action', async () => {
    await act(async () => {
      toast.error('Could not save', {
        description: 'Try again',
        action: { label: 'Retry', onClick: () => {} },
      })
    })
    expect(document.body.textContent).toContain('Could not save')
    expect(document.body.textContent).toContain('Try again')
    expect(document.body.textContent).toContain('Retry')
  })

  it('dismisses by the id the host toaster returned and reports the dismissal', async () => {
    const onDismiss = vi.fn()
    let id = ''
    await act(async () => {
      id = toast({ message: 'Importing', duration: 0, onDismiss })
    })
    expect(id).not.toBe('')
    expect(document.body.textContent).toContain('Importing')
    await act(async () => {
      toast.dismiss(id)
    })
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
