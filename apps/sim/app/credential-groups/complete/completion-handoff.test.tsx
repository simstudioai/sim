/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CredentialGroupCompletionHandoff } from '@/app/credential-groups/complete/completion-handoff'

describe('credential group OAuth completion', () => {
  it.each([undefined, 'failed', 'denied', 'configuration_changed'] as const)(
    'publishes %s to only its initiating tab and keeps failures visible',
    (failure) => {
      const postMessage = vi.fn()
      const closeChannel = vi.fn()
      const names: string[] = []
      vi.stubGlobal(
        'BroadcastChannel',
        class {
          postMessage = postMessage
          close = closeChannel
          constructor(name: string) {
            names.push(name)
          }
        }
      )
      const closeWindow = vi.spyOn(window, 'close').mockImplementation(() => {})
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      const container = document.createElement('div')
      const root = createRoot(container)
      const completionId = '550e8400-e29b-41d4-a716-446655440000'
      try {
        act(() =>
          root.render(
            <CredentialGroupCompletionHandoff completionId={completionId} failure={failure} />
          )
        )
        expect(names).toEqual([`sim:credential-group-oauth:${completionId}`])
        expect(postMessage).toHaveBeenCalledExactlyOnceWith(failure ?? 'connected')
        expect(closeChannel).toHaveBeenCalledOnce()
        if (failure) expect(closeWindow).not.toHaveBeenCalled()
        else expect(closeWindow).toHaveBeenCalledOnce()
      } finally {
        act(() => root.unmount())
      }
    }
  )
})
