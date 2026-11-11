/**
 * @vitest-environment jsdom
 *
 * A credential's name and description drafts against the saved credential the detail query keeps
 * refreshing. Failure modes: a refresh that overwrites what the user typed, a draft left dirty after
 * the saved value catches up to it, a revert typed while a save is in flight lost when that save
 * lands, and a save that sends fields the user never touched or drops the draft when it fails.
 */
import { act } from 'react'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceCredential } from '@/lib/api/contracts/credentials'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import { useCredentialDetailForm } from '@/platform/lib/data/secrets/use-credential-detail-form'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const credential: WorkspaceCredential = {
  id: 'credential-a',
  workspaceId: 'workspace-a',
  type: 'env_workspace',
  displayName: 'Saved name',
  description: 'Saved description',
  unredacted: false,
  providerId: null,
  accountId: null,
  envKey: 'TOKEN',
  envOwnerUserId: null,
  createdBy: 'user-a',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  role: 'admin',
}

function CredentialEditor() {
  const { data } = useWorkspaceCredential(credential.id)
  const form = useCredentialDetailForm({ credential: data ?? null, isAdmin: true })
  // The page registers the draft through its SettingsSaveBar, which this stands in for.
  useSettingsUnsavedGuard({
    isDirty: form.isDirty,
    navigationBlocked: form.isSaving,
    onDiscard: form.discard,
  })
  return (
    <>
      <input
        aria-label='Name'
        value={form.displayNameDraft}
        onChange={(event) => form.setDisplayNameDraft(event.target.value)}
      />
      <input
        aria-label='Description'
        value={form.descriptionDraft}
        onChange={(event) => form.setDescriptionDraft(event.target.value)}
      />
      <button type='button' onClick={() => void form.save()}>
        Save credential
      </button>
      <button type='button' onClick={form.discard}>
        Discard credential
      </button>
    </>
  )
}

let root: Root
let container: HTMLDivElement
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useSettingsDirtyStore.getState().reset()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  client.setQueryData(workspaceCredentialKeys.detail(credential.id), credential)
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

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CredentialEditor />
      </QueryClientProvider>
    )
    await vi.advanceTimersByTimeAsync(1)
  })
}

function input(label: string) {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
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

function click(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  )
  if (!button) throw new Error(`Missing button ${text}`)
  act(() => button.click())
}

/** Whether Settings lets the viewer leave now, or holds the leave behind its discard prompt. */
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

async function refresh(next: WorkspaceCredential) {
  await act(async () => {
    client.setQueryData(workspaceCredentialKeys.detail(credential.id), next)
    await vi.advanceTimersByTimeAsync(1)
  })
}

async function settle(ms = 1) {
  await act(async () => {
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('credential metadata drafts', () => {
  it('becomes clean when an authored field converges with a same-ID saved refresh', async () => {
    await render()
    edit('Description', 'Shared description')
    expectLeave(false)
    await refresh({ ...credential, displayName: 'Remote name', description: 'Shared description' })
    expectLeave(true)
    expect(input('Name').value).toBe('Remote name')
    edit('Description', 'Another edit')
    expectLeave(false)
    edit('Description', 'Shared description')
    expectLeave(true)
  })

  it('follows same-ID refreshes while untouched, preserves authored edits, and resumes saved values on revert', async () => {
    await render()
    expectLeave(true)
    await refresh({ ...credential, displayName: 'Refreshed name' })
    expect(input('Name').value).toBe('Refreshed name')
    expectLeave(true)
    edit('Description', 'My draft')
    expectLeave(false)
    await refresh({
      ...credential,
      displayName: 'Latest name',
      description: 'Latest description',
    })
    expect(input('Description').value).toBe('My draft')
    expectLeave(false)
    edit('Description', 'Latest description')
    expectLeave(true)
    expect(input('Name').value).toBe('Latest name')
  })

  it('preserves a revert typed while a different description is being saved', async () => {
    const request = createDeferred<Response>()
    let persisted = credential
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? request.promise
          : Promise.resolve(jsonResponse({ credential: persisted }))
      )
    )
    await render()
    edit('Description', 'Submitted description')
    click('Save credential')
    await settle(50)
    edit('Description', credential.description ?? '')
    expect(input('Description').value).toBe(credential.description)
    persisted = { ...credential, description: 'Submitted description' }
    await act(async () => {
      request.resolve(jsonResponse({ credential: persisted }))
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(input('Description').value).toBe(credential.description)
    expectLeave(false)
  })

  it('saves only authored metadata and retains a failed draft', async () => {
    const request = createDeferred<Response>()
    let payload: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          payload = JSON.parse(String(init.body))
          return request.promise
        }
        return Promise.resolve(jsonResponse({ credential }))
      })
    )
    await render()
    edit('Description', 'My draft')
    await refresh({ ...credential, displayName: 'Remote name' })
    click('Save credential')
    await settle()
    expect(payload).toEqual({ description: 'My draft' })
    expectLeave(false)
    await act(async () => {
      request.resolve(jsonResponse({ error: 'Unable to save' }, 503))
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(input('Description').value).toBe('My draft')
    expectLeave(false)
    click('Discard credential')
    expectLeave(true)
  })
})
