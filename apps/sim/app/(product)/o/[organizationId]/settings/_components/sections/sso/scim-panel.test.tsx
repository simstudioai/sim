/**
 * @vitest-environment jsdom
 *
 * A SCIM token is shown once: Sim keeps only its digest. Failure mode: leaving Settings while the
 * issued token's dialog is open loses the token without a prompt, and the admin must revoke it and
 * issue another.
 */
import { act } from 'react'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { jsonResponse } from '@sim/testing/helpers/http'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ScimPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/scim-panel'
import { useSettingsDirtyStore } from '@/platform/lib/data/settings-guard'

const CONNECTION = {
  id: 'connection-a',
  status: 'active',
  baseUrl: 'https://example.com/scim',
  settings: {},
  lastRequestAt: null,
  reconciledAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  credentials: [],
  userCount: 0,
  groupCount: 1,
}

/** jsdom has no modal dialogs: opening one only marks it open, as the browser's top layer would. */
function stubDialogs() {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  Element.prototype.checkVisibility ??= () => true
}

let root: Root
let container: HTMLDivElement
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialogs()
  useSettingsDirtyStore.getState().reset()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  // `scimKeys` is private to its hook module; this is its connection key for `org-a`.
  client.setQueryData(['scim', 'connection', 'org-a'], { connection: CONNECTION })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
    await flushMicrotasks()
  })
  client.clear()
  container.remove()
  vi.useRealTimers()
})

/** Lets every pending read and write answer: a response body is read across several turns. */
async function settle() {
  for (let turn = 0; turn < 5; turn++) {
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(10)
  }
}

function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  )
  if (!button) throw new Error(`Missing button ${text}`)
  act(() => button.click())
}

function expectLeave(allowed: boolean) {
  let left = false
  act(() =>
    useSettingsDirtyStore.getState().requestLeave(() => {
      left = true
    })
  )
  expect(left).toBe(allowed)
  useSettingsDirtyStore.getState().cancelLeave()
}

it('protects the only retrievable SCIM token until its dialog is dismissed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const { pathname } = new URL(String(url), 'https://sim.test')
      if (init?.method === 'POST' && pathname === '/api/organizations/org-a/scim/credentials')
        return Promise.resolve(
          jsonResponse(
            {
              secret: 'test-only-scim-token',
              credential: {
                id: 'token-a',
                tokenPrefix: 'test-only',
                scopes: ['users:read'],
                expiresAt: null,
                lastUsedAt: null,
                createdAt: '2026-01-01T00:00:00Z',
              },
            },
            201
          )
        )
      if (pathname === '/api/organizations/org-a/scim')
        return Promise.resolve(jsonResponse({ connection: CONNECTION }))
      return Promise.resolve(jsonResponse({ error: 'Not found' }, 404))
    })
  )
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ScimPanel organizationId='org-a' active onOpenDomains={() => {}} />
      </QueryClientProvider>
    )
    await settle()
  })
  expectLeave(true)
  click('Issue token')
  await act(async () => {
    await settle()
  })
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Token"]')?.value,
    'the issued token is shown'
  ).toBe('test-only-scim-token')
  expectLeave(false)
  click('Done')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expectLeave(true)
})
