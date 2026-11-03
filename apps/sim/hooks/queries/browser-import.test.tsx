/** @vitest-environment jsdom */

import { act } from 'react'
import type { BrowserPendingSignIn } from '@sim/desktop-bridge'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingSignIn, useStartSignInHandoff } from '@/hooks/queries/browser-import'

/** The shell's pending sign-ins, by chat scope id. */
let pendingByScope: Record<string, BrowserPendingSignIn>
let finishLaunch: (() => void) | undefined
let shown: BrowserPendingSignIn | null | undefined
let start: ((profileId: string) => Promise<unknown>) | undefined

interface PanelProps {
  scopeId: string
}

function Panel({ scopeId }: PanelProps) {
  shown = usePendingSignIn(scopeId, true).data
  start = useStartSignInHandoff(scopeId).mutateAsync
  return null
}

let root: Root | undefined

describe('pending sign-in after a chat is saved mid-handoff', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    pendingByScope = {}
    Object.assign(window, {
      simDesktop: {
        browserImport: {
          getPendingSignIn: async (scopeId: string) => pendingByScope[scopeId] ?? null,
          continueSignIn: (_profileId: string, _scopeId: string) =>
            new Promise((resolve) => {
              finishLaunch = () => {
                // The provisional chat saved meanwhile; the shell moved its handoff to the saved id.
                const pending = { site: 'github.com', browserLabel: 'Chrome' }
                pendingByScope['chat-1'] = pending as BrowserPendingSignIn
                resolve({ pending })
              }
            }),
          bringSignInBack: vi.fn(),
          cancelSignIn: vi.fn(),
        },
      },
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    Reflect.deleteProperty(window, 'simDesktop')
  })

  it("shows the handoff under the saved chat's id once the launch settles", async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    const client = new QueryClient()
    const render = (scopeId: string) =>
      act(async () => {
        root?.render(
          <QueryClientProvider client={client}>
            {/* The browser panel is keyed by its scope, so a saved chat id remounts it. */}
            <Panel key={scopeId} scopeId={scopeId} />
          </QueryClientProvider>
        )
      })

    await render('draft-1')
    let launch: Promise<unknown> | undefined
    await act(async () => {
      launch = start?.('profile-1')
    })
    await render('chat-1')
    await vi.waitFor(() => expect(shown).toBeNull())

    await act(async () => {
      finishLaunch?.()
      await launch
    })
    await vi.waitFor(() => expect(shown).toMatchObject({ site: 'github.com' }))
  })
})
