/**
 * @vitest-environment jsdom
 *
 * The session policy form against its save. Failure mode: an edit typed while an earlier save is in
 * flight is overwritten when that save lands, and the form reads as saved with the newer value lost.
 */
import { act } from 'react'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import SecuritySection from '@/app/(product)/o/[organizationId]/settings/_components/sections/security/security-section'
import { useSettingsDirtyStore } from '@/platform/lib/data/settings-guard'

const MAX_HOURS = 'Max session lifetime (hours)'
const SAVED = { isEnterprise: true, configured: { maxSessionHours: 720, idleTimeoutHours: null } }

/** Only what the section reads: the organization's id and the deployment's session-policy gate. */
const organization = {
  organization: { id: 'org-a' },
  deployment: { hosted: true, billingEnabled: true, features: { sessionPolicies: true } },
} as SettingsSectionProps['organization']

let root: Root
let container: HTMLDivElement
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  useSettingsDirtyStore.getState().reset()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  // `sessionPolicyKeys.settings('org-a')`: a view's test reads hooks only through the data seam.
  client.setQueryData(['sessionPolicy', 'settings', 'org-a'], SAVED)
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

function input(label: string) {
  const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!field) throw new Error(`Missing input ${label}`)
  return field
}

function edit(label: string, value: string) {
  const field = input(label)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Missing input setter')
  act(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Lets every pending read and write answer: a response body is read across several turns. */
async function settle() {
  for (let turn = 0; turn < 5; turn++) {
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(10)
  }
}

function click(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
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

it('retains newer session-policy edits when an earlier save completes', async () => {
  const request = createDeferred<Response>()
  const writes: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        writes.push(JSON.parse(String(init.body)))
        return request.promise
      }
      if (String(url).includes('/session-policy'))
        return Promise.resolve(jsonResponse({ success: true, data: SAVED }))
      return Promise.resolve(jsonResponse({ error: 'Not found' }, 404))
    })
  )
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SecuritySection organization={organization} subpath={[]} query={{}} />
      </QueryClientProvider>
    )
    await settle()
  })
  expect(input(MAX_HOURS).value).toBe('720')
  expectLeave(true)
  edit(MAX_HOURS, '100')
  click('Save')
  await act(async () => {
    await settle()
  })
  expect(writes).toEqual([{ maxSessionHours: 100, idleTimeoutHours: null }])
  edit(MAX_HOURS, '200')
  await act(async () => {
    request.resolve(
      jsonResponse({
        success: true,
        data: { ...SAVED, configured: { maxSessionHours: 100, idleTimeoutHours: null } },
      })
    )
    await settle()
  })
  expect(input(MAX_HOURS).value).toBe('200')
  expectLeave(false)
})

it('holds a leave while the save is in flight, then lets it go once saved', async () => {
  const request = createDeferred<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return request.promise
      if (String(url).includes('/session-policy'))
        return Promise.resolve(jsonResponse({ success: true, data: SAVED }))
      return Promise.resolve(jsonResponse({ error: 'Not found' }, 404))
    })
  )
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SecuritySection organization={organization} subpath={[]} query={{}} />
      </QueryClientProvider>
    )
    await settle()
  })
  edit(MAX_HOURS, '100')
  click('Save')
  await act(async () => {
    await settle()
  })
  let left = false
  act(() =>
    useSettingsDirtyStore.getState().requestLeave(() => {
      left = true
    })
  )
  expect(left).toBe(false)
  expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
  await act(async () => {
    request.resolve(
      jsonResponse({
        success: true,
        data: { ...SAVED, configured: { maxSessionHours: 100, idleTimeoutHours: null } },
      })
    )
    await settle()
  })
  expect(input(MAX_HOURS).value).toBe('100')
  expectLeave(true)
})
