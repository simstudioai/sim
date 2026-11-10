/**
 * @vitest-environment jsdom
 *
 * Registering an identity provider against its pending write. Failure modes: a second submit while
 * the first is in flight registers the provider twice, an edit made meanwhile changes what the
 * pending write appears to have saved, leaving Settings mid-write abandons it, and a refused write
 * drops the form the admin filled in.
 */
import { act } from 'react'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProviderForm } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/provider-form'
import { DEFAULT_SSO_FORM } from '@/platform/lib/data/sso'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const FILLED_FORM = {
  ...DEFAULT_SSO_FORM,
  providerId: 'example',
  issuerUrl: 'https://identity.example.com',
  domain: 'example.com',
  clientId: 'initial-client',
  clientSecret: 'test-secret',
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
  useSettingsDirtyStore.getState().reset()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
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

async function submit() {
  const form = container.querySelector('form')
  if (!form) throw new Error('Missing provider form')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
  })
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

it('blocks duplicate SSO submissions and changes while provider configuration is pending', async () => {
  const request = createDeferred<Response>()
  const submitted: { clientId?: string; oidcConfig?: { clientId?: string } }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        submitted.push(JSON.parse(String(init.body)))
        return submitted.length === 1
          ? request.promise
          : Promise.resolve(jsonResponse({ error: 'Unable to configure' }, 503))
      }
      return Promise.resolve(jsonResponse({ providers: [] }))
    })
  )
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ProviderForm organizationId='org-a' initialForm={FILLED_FORM} onSaved={() => {}} />
      </QueryClientProvider>
    )
    await settle()
  })
  expectLeave(true)
  edit('Client ID', 'test-client')
  expectLeave(false)

  await submit()
  expect(submitted).toHaveLength(1)
  edit('Client ID', 'changed-mid-write')
  expect(input('Client ID').value).toBe('test-client')
  await submit()
  expect(submitted).toHaveLength(1)

  let left = false
  act(() =>
    useSettingsDirtyStore.getState().requestLeave(() => {
      left = true
    })
  )
  expect(left).toBe(false)
  expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()

  await act(async () => {
    request.resolve(jsonResponse({ error: 'Unable to configure' }, 503))
    await settle()
  })
  expect(input('Client ID').value).toBe('test-client')
  expectLeave(false)
  await submit()
  expect(submitted).toHaveLength(2)
  expect(JSON.stringify(submitted[1])).toContain('test-client')
})
