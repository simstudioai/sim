/** @vitest-environment jsdom */
import { act } from 'react'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { jsonResponse } from '@sim/testing/helpers/http'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsNavigationGuard } from '@/components/settings/settings-navigation-guard'
import { type BenchmarkCase, updateBenchmarkContract } from '@/lib/api/contracts/benchmarks'
import { BenchmarkConsole } from '@/app/benchmark/benchmark-console'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('next/navigation', () => nextNavigationMock)

let root: Root
let container: HTMLDivElement
let client: QueryClient
let saved: BenchmarkCase
let patches: unknown[]
let failSave: boolean

async function settle(action: () => void) {
  await act(async () => {
    action()
    await flushMicrotasks()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
    await flushMicrotasks()
  })
}

function button(name: string) {
  const value = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === name
  )
  if (!value) throw new Error(`Missing button ${name}`)
  return value
}

function field(selector: string) {
  const value = document.querySelector<HTMLTextAreaElement>(selector)
  if (!value) throw new Error(`Missing field ${selector}`)
  return value
}

async function edit(selector: string, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!setter) throw new Error('Missing textarea setter')
  await settle(() => {
    const target = field(selector)
    setter.call(target, value)
    target.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: { id: 'operator' } },
    isPending: false,
    error: null,
  })
  useSettingsDirtyStore.getState().reset()
  patches = []
  failSave = false
  saved = {
    id: 'case',
    organizationId: 'org',
    userId: 'operator',
    runAsUserId: 'user',
    sourceWorkspaceId: 'workspace',
    name: 'Fixture benchmark',
    version: 1,
    runningStage: null,
    leaseExpiresAt: null,
    attemptId: null,
    plannerChatId: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    artifacts: {
      taskBrief: 'Prepare a workflow',
      referenceSpec: 'Send the report to Operations.',
      redactedSpec: '',
      blanks: [],
      generatedSpec: null,
      reconstruction: null,
      grade: null,
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/benchmarks/organizations')
        return jsonResponse({
          organizations: [{ id: 'other-org', name: 'Other organization' }],
          selected: { id: 'org', name: 'Fixture organization' },
          nextCursor: null,
        })
      if (url.pathname.endsWith('/users'))
        return jsonResponse({
          users: [{ id: 'other-user', name: 'Other user', email: 'other@example.test' }],
          selected: { id: 'user', name: 'Fixture user', email: 'fixture@example.test' },
          nextCursor: null,
        })
      if (url.pathname.endsWith('/workspaces'))
        return jsonResponse({
          workspaces: [{ id: 'workspace', name: 'Fixture workspace' }],
          canPlan: true,
          nextCursor: null,
        })
      if (url.pathname.endsWith('/runs')) return jsonResponse({ runs: [], nextCursor: null })
      if (url.pathname.endsWith('/benchmarks'))
        return jsonResponse({ benchmarks: [saved], nextCursor: null })
      if (url.pathname.endsWith('/benchmarks/case')) {
        if (init?.method === 'PATCH') {
          const schema = updateBenchmarkContract.body
          if (!schema) throw new Error('Missing benchmark update contract')
          const patch = schema.parse(JSON.parse(String(init.body)))
          patches.push(patch)
          if (failSave) return jsonResponse({ error: 'Save unavailable' }, 503)
          const { version, name, ...artifacts } = patch
          saved = {
            ...saved,
            name: name ?? saved.name,
            version: version + 1,
            artifacts: { ...saved.artifacts, ...artifacts },
          }
        }
        return jsonResponse({ benchmark: saved })
      }
      throw new Error(`Unexpected fixture request ${url.pathname}`)
    })
  )
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await settle(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter searchParams='?organization=org&user=user&benchmark=case' hasMemory>
          <SettingsNavigationGuard />
          <BenchmarkConsole />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
  expect(field('#reference-spec').value).toBe(saved.artifacts.referenceSpec)
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  useSettingsDirtyStore.getState().reset()
  vi.useRealTimers()
})

async function navigate(destination: string) {
  if (destination === 'Organization' || destination === 'Run as user') {
    const combo = document.querySelector<HTMLElement>(
      `[role="combobox"][aria-label="${destination}"]`
    )
    if (!combo) throw new Error(`Missing selection ${destination}`)
    await settle(() => combo.click())
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
      node.textContent?.includes(
        destination === 'Organization' ? 'Other organization' : 'Other user'
      )
    )
    if (!option) throw new Error(`Missing option ${destination}`)
    await settle(() => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  } else await settle(() => button(destination).click())
}

it.each(['Run history', 'All benchmarks', 'New benchmark', 'Organization', 'Run as user'])(
  'keeps the reference until navigation to %s is explicitly discarded',
  async (destination) => {
    await edit('#reference-spec', 'Unsaved reference')
    await navigate(destination)
    expect(field('#reference-spec').value).toBe('Unsaved reference')
    await settle(() => button('Keep editing').click())
    expect(field('#reference-spec').value).toBe('Unsaved reference')
    expect(patches).toEqual([])
    await navigate(destination)
    await settle(() => button('Discard changes').click())
    expect(document.querySelector('#reference-spec')).toBeNull()
    expect(patches).toEqual([])
    expect(useSettingsDirtyStore.getState().isDirty).toBe(false)
  }
)

it('keeps applied blanks through a cancelled navigation and failed save, then saves exact edits', async () => {
  await settle(() => button('Edit JSON').click())
  const textareas = [...document.querySelectorAll<HTMLTextAreaElement>('[role="dialog"] textarea')]
  expect(textareas).toHaveLength(2)
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!setter) throw new Error('Missing textarea setter')
  await settle(() => {
    for (const [index, value] of [
      'Send the report to [[BLANK:team]].',
      '{"team":"Operations"}',
    ].entries()) {
      setter.call(textareas[index], value)
      textareas[index].dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await settle(() => button('Apply mapping').click())
  await navigate('Run history')
  await settle(() => button('Keep editing').click())
  expect(field('[aria-label="Redacted reference spec"]').value).toBe(
    'Send the report to [[BLANK:team]].'
  )
  failSave = true
  await settle(() => button('Save changes').click())
  await navigate('All benchmarks')
  await settle(() => button('Keep editing').click())
  failSave = false
  await settle(() => button('Save changes').click())
  expect(patches).toEqual([
    {
      version: 1,
      redactedSpec: 'Send the report to [[BLANK:team]].',
      blanks: [{ id: 'team', answer: 'Operations' }],
    },
    {
      version: 1,
      redactedSpec: 'Send the report to [[BLANK:team]].',
      blanks: [{ id: 'team', answer: 'Operations' }],
    },
  ])
  await navigate('Run history')
  await navigate('Current run')
  expect(field('[aria-label="Redacted reference spec"]').value).toBe(
    'Send the report to [[BLANK:team]].'
  )
  expect(useSettingsDirtyStore.getState().isDirty).toBe(false)
})
