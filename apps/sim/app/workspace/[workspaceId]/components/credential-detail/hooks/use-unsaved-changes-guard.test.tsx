/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { useUnsavedChangesGuard } from '@/app/workspace/[workspaceId]/components/credential-detail/hooks/use-unsaved-changes-guard'

function mountEmbeddedDirtyGuard(): () => void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root: Root = createRoot(document.createElement('div'))

  function Probe() {
    useUnsavedChangesGuard({
      isDirty: true,
      backHref: '/workspace/ws-1/skills',
      trapHistory: false,
    })
    return null
  }

  act(() => root.render(<Probe />))
  return () => act(() => root.unmount())
}

describe('useUnsavedChangesGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps unload protection without seeding a route history sentinel when embedded', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const unmount = mountEmbeddedDirtyGuard()

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)

    expect(pushState).not.toHaveBeenCalled()
    expect(beforeUnload.defaultPrevented).toBe(true)

    unmount()
  })
})
