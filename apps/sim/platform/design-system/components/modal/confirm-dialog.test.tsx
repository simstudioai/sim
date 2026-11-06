/** @vitest-environment jsdom */

import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { stubDialogMethods, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { onlineManager, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/app/_shell/providers/get-query-client'
import { ConfirmDialog } from '@/platform/design-system/components/modal/confirm-dialog'

const send = vi.fn()
const onClose = vi.fn()

function RemoveDialog() {
  const remove = useMutation({ mutationFn: send })
  return (
    <ConfirmDialog
      target
      onClose={onClose}
      title='Remove'
      confirmLabel='Remove it'
      pendingLabel='Removing…'
      onConfirm={() => remove.mutateAsync(undefined)}
    />
  )
}

describe('ConfirmDialog while the browser is offline', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (name: string) =>
    Array.from(container.querySelectorAll('button')).find((node) => node.textContent === name)

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    stubResizeObserver()
    stubDialogMethods()
    send.mockReset().mockRejectedValue(new TypeError('Failed to fetch'))
    onlineManager.setOnline(false)
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <QueryClientProvider client={makeQueryClient()}>
          <RemoveDialog />
        </QueryClientProvider>
      )
    })
  })

  afterEach(() => {
    onlineManager.setOnline(true)
    act(() => root.unmount())
    container.remove()
  })

  it('reports the failed action and can still be cancelled', async () => {
    await act(async () => {
      button('Remove it')?.click()
      await flushMacrotask()
    })

    expect(send).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Failed to fetch')

    await act(async () => {
      button('Cancel')?.click()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
