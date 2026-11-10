/**
 * @vitest-environment jsdom
 *
 * "Fix in Chat" (the terminal's row menu, a block error's toast, a deprecated block's Fix) hands a
 * message to a new chat. Failure modes: the message going nowhere because no chat is mounted to
 * receive it, the viewer left on the editor, and a handoff where chat is withheld from the viewer.
 */
import { act } from 'react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { surface } = vi.hoisted(() => ({
  surface: {
    organization: { id: 'org-1' },
    routePrefix: '/o/org-1',
    mothershipAvailable: true,
  },
}))

vi.mock('@/platform/lib/data/organization', () => ({ useOrganization: () => surface }))

import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { useChatHandoff } from '@/platform/lib/data/chat-handoff'

const mounted: Root[] = []
const router = {
  bfcacheId: 'test',
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}

function renderHandoff() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mounted.push(root)
  let handoff: ReturnType<typeof useChatHandoff> | undefined
  function Probe() {
    handoff = useChatHandoff()
    return null
  }
  act(() =>
    root.render(
      <AppRouterContext.Provider value={router}>
        <Probe />
      </AppRouterContext.Provider>
    )
  )
  if (!handoff) throw new Error('The probe did not render')
  return handoff
}

describe('useChatHandoff', () => {
  beforeEach(() => {
    surface.mothershipAvailable = true
    window.localStorage.clear()
  })

  afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount())
  })

  it("stores the message for the organization's chat and opens it", () => {
    const context = {
      kind: 'workflow_block' as const,
      workflowId: 'wf-1',
      blockId: 'block-1',
      label: 'Agent',
    }

    renderHandoff().handOff({ message: 'Error in Agent. Please fix this.', contexts: [context] })

    expect(router.push).toHaveBeenCalledWith('/o/org-1/chat')
    const stored = MothershipHandoffStorage.consume({ organizationId: 'org-1' })
    expect(stored?.message).toBe('Error in Agent. Please fix this.')
    expect(stored?.contexts).toEqual([context])
  })

  it('hands nothing off where the viewer cannot start a chat', () => {
    surface.mothershipAvailable = false

    const handoff = renderHandoff()
    handoff.handOff({ message: 'Error in Agent. Please fix this.' })

    expect(handoff.available).toBe(false)
    expect(router.push).not.toHaveBeenCalled()
    expect(MothershipHandoffStorage.consume({ organizationId: 'org-1' })).toBeNull()
  })
})
