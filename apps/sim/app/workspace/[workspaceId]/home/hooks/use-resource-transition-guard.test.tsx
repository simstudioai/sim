/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useResourceTransitionGuard } from '@/app/workspace/[workspaceId]/home/hooks/use-resource-transition-guard'

function renderGuard() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root: Root = createRoot(document.createElement('div'))
  let latest: ReturnType<typeof useResourceTransitionGuard>

  function Probe() {
    latest = useResourceTransitionGuard()
    return null
  }

  act(() => root.render(<Probe />))
  return { result: () => latest, unmount: () => act(() => root.unmount()) }
}

describe('useResourceTransitionGuard', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps a dirty draft when cancelled and performs the complete deferred action on discard', () => {
    const selectAnotherTab = vi.fn()
    const closeSelectedTabs = vi.fn()
    const guard = renderGuard()

    act(() => guard.result().reportResourceDirty('skill-1', true))
    act(() => guard.result().requestResourceTransition(selectAnotherTab))

    expect(selectAnotherTab).not.toHaveBeenCalled()
    expect(guard.result().showDiscardConfirmation).toBe(true)

    act(() => guard.result().dismissDiscardConfirmation())

    expect(selectAnotherTab).not.toHaveBeenCalled()
    expect(guard.result().showDiscardConfirmation).toBe(false)

    act(() => guard.result().requestResourceTransition(closeSelectedTabs))
    act(() => guard.result().confirmDiscard())

    expect(closeSelectedTabs).toHaveBeenCalledOnce()
    expect(guard.result().showDiscardConfirmation).toBe(false)

    act(() => guard.result().requestResourceTransition(selectAnotherTab))
    expect(selectAnotherTab).toHaveBeenCalledOnce()
    guard.unmount()
  })

  it('marks agent activity without focusing over a dirty editor or opening a modal', () => {
    const focus = vi.fn()
    const markAttention = vi.fn()
    const guard = renderGuard()

    act(() => guard.result().reportResourceDirty('skill-1', true))
    act(() => guard.result().routeAutomaticResourceFocus('skill-1', 'mcp-1', focus, markAttention))

    expect(focus).not.toHaveBeenCalled()
    expect(markAttention).toHaveBeenCalledOnce()
    expect(guard.result().showDiscardConfirmation).toBe(false)
    guard.unmount()
  })

  it('guards browser unload and replays app-link navigation only after discard', () => {
    const guard = renderGuard()
    const link = document.createElement('a')
    link.href = '/workspace/ws-1/chat/chat-2'
    link.textContent = 'Another chat'
    const navigate = vi.fn((event: MouseEvent) => event.preventDefault())
    link.addEventListener('click', navigate)
    document.body.appendChild(link)

    act(() => guard.result().reportResourceDirty('custom-tool-1', true))

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)

    act(() => link.click())
    expect(navigate).not.toHaveBeenCalled()
    expect(guard.result().showDiscardConfirmation).toBe(true)

    act(() => guard.result().dismissDiscardConfirmation())
    expect(navigate).not.toHaveBeenCalled()

    act(() => link.click())
    act(() => guard.result().confirmDiscard())
    expect(navigate).toHaveBeenCalledOnce()
    expect(guard.result().showDiscardConfirmation).toBe(false)

    const cleanBeforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanBeforeUnload)
    expect(cleanBeforeUnload.defaultPrevented).toBe(false)
    guard.unmount()
  })
})
