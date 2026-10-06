/** @vitest-environment jsdom */

import { act } from 'react'
import { toast } from '@sim/emcn'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import {
  type CustomBlock,
  type UpdateCustomBlockBody,
  updateCustomBlockBodySchema,
} from '@/lib/api/contracts/custom-blocks'
import * as uploads from '@/lib/uploads/client/session-upload'
import { CustomBlockDetail } from '@/ee/custom-blocks/components/custom-block-detail'
import { customBlockKeys } from '@/hooks/queries/custom-blocks'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

vi.mock('@/lib/workflows/blocks/block-outputs', () => ({
  getEffectiveBlockOutputs: () => ({ response: { type: 'string' } }),
}))

const savedBlock: CustomBlock = {
  id: 'block-a',
  organizationId: 'org-a',
  workspaceId: 'workspace-a',
  workflowId: 'workflow-a',
  workflowName: 'Workflow A',
  workspaceName: 'Workspace A',
  type: 'custom_block_a',
  name: 'Block A',
  description: 'Saved description',
  enabled: true,
  iconUrl: null,
  traceChildRuns: false,
  inputFields: [{ id: 'input-a', name: 'first', type: 'string' }],
  exposedOutputs: [{ blockId: 'result', path: 'response', name: 'response' }],
}

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let departures: number

function setBlock(block: CustomBlock) {
  queryClient.setQueryData(customBlockKeys.list('workspace-a'), {
    enabled: true,
    customBlocks: [block],
  })
}

function setDeployment(fields = savedBlock.inputFields, includeResult = true) {
  queryClient.setQueryData(deploymentKeys.deployedState('workflow-a'), {
    blocks: {
      start: {
        id: 'start',
        type: 'starter',
        name: 'Start',
        subBlocks: { inputFormat: { value: fields } },
      },
      ...(includeResult ? { result: { id: 'result', type: 'function', name: 'Result' } } : {}),
    },
    edges: [],
  })
}

async function render(blockId: string | null = savedBlock.id) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <CustomBlockDetail
              blockId={blockId}
              workspaceId='workspace-a'
              onBack={() => {
                departures++
              }}
            />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </QueryClientProvider>
    )
    await vi.runOnlyPendingTimersAsync()
  })
}

async function refresh(update: () => void) {
  await act(async () => {
    update()
    await vi.runOnlyPendingTimersAsync()
  })
}

function expectNavigation(allowed: boolean) {
  let left = false
  act(() => {
    useSettingsDirtyStore.getState().requestLeave(() => {
      left = true
    })
  })
  expect(left).toBe(allowed)
  useSettingsDirtyStore.getState().cancelLeave()
}

function field<T extends HTMLElement>(selector: string): T {
  const element = container.querySelector<T>(selector)
  if (!element) throw new Error(`Missing field: ${selector}`)
  return element
}

function edit(selector: string, value: string) {
  const element = field<HTMLInputElement | HTMLTextAreaElement>(selector)
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('Missing native value setter')
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function clickButton(text: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => element.textContent?.trim() === text
  )
  if (!button) throw new Error(`Missing button: ${text}`)
  act(() => {
    button.click()
  })
}

beforeEach(() => {
  vi.spyOn(toast, 'success').mockReturnValue('toast-a')
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  setBlock(savedBlock)
  setDeployment()
  queryClient.setQueryData(customBlockKeys.usages(savedBlock.id), { usageCount: 0 })
  queryClient.setQueryData(workspaceKeys.list(), {
    workspaces: [
      { id: 'workspace-a', name: 'Workspace A', organizationId: 'org-a', permissions: 'admin' },
    ],
  })
  queryClient.setQueryData(workflowKeys.list('workspace-a', 'active'), [])
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  departures = 0
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
    await flushMicrotasks()
  })
  queryClient.clear()
  container.remove()
  vi.useRealTimers()
})

describe('custom block unsaved changes', () => {
  it.each(['added input', 'removed output', 'refreshed saved values'] as const)(
    'allows tab and back navigation after %s without an edit',
    async (change) => {
      await render()
      expectNavigation(true)
      await refresh(() => {
        if (change === 'added input') {
          setDeployment([
            ...savedBlock.inputFields,
            { id: 'input-b', name: 'second', type: 'string' },
          ])
        } else if (change === 'removed output') {
          setDeployment(savedBlock.inputFields, false)
        } else {
          setBlock({
            ...savedBlock,
            name: 'Updated block',
            description: 'Refreshed description',
            iconUrl: '/api/files/serve/saved-icon',
            traceChildRuns: true,
          })
        }
      })
      expectNavigation(true)
      clickButton('Custom blocks')
      expect(departures).toBe(1)
    }
  )

  it('starts clean when saved text has padding and input overrides are empty', async () => {
    setBlock({
      ...savedBlock,
      name: ' Block A ',
      description: ' Saved description ',
      inputFields: [{ ...savedBlock.inputFields[0], placeholder: ' ', required: false }],
    })
    await render()
    expectNavigation(true)
  })

  it('keeps a real edit and its baseline across a refresh, and becomes clean on revert', async () => {
    await render()
    edit('input[placeholder="Invoice Parser"]', 'My draft')
    await refresh(() =>
      setBlock({ ...savedBlock, name: 'Server draft', description: 'Server update' })
    )
    expect(field<HTMLInputElement>('input[placeholder="Invoice Parser"]').value).toBe('My draft')
    expectNavigation(false)
    edit('input[placeholder="Invoice Parser"]', savedBlock.name)
    expectNavigation(true)
    expect(field<HTMLTextAreaElement>('textarea').value).toBe('Server update')
  })

  it('discards to the latest saved values after a refresh', async () => {
    await render()
    edit('textarea', 'Unsaved description')
    await refresh(() => setBlock({ ...savedBlock, description: 'Server update' }))
    clickButton('Discard')
    expect(field<HTMLTextAreaElement>('textarea').value).toBe('Server update')
    expectNavigation(true)
  })

  it('becomes clean when an override on a newly deployed input is reverted', async () => {
    await render()
    await refresh(() =>
      setDeployment([...savedBlock.inputFields, { id: 'input-b', name: 'second', type: 'string' }])
    )
    const row = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(
      (element) => element.textContent?.includes('second')
    )
    if (!row) throw new Error('Missing input row')
    act(() => {
      row.click()
    })
    const required = field<HTMLButtonElement>('#input-required-input-b')
    act(() => {
      required.click()
    })
    expectNavigation(false)
    act(() => {
      required.click()
    })
    expectNavigation(true)
  })

  it('retains edits to an output when that output disappears from the deployment', async () => {
    await render()
    edit('input[placeholder="name"]', 'renamed')
    await refresh(() => setDeployment(savedBlock.inputFields, false))
    expectNavigation(false)
    clickButton('Discard')
    expectNavigation(true)
  })

  it('preserves icon removal through refresh and restores the newest icon on discard', async () => {
    setBlock({ ...savedBlock, iconUrl: '/api/files/serve/original-icon' })
    await render()
    act(() => {
      field<HTMLButtonElement>('button[aria-label="Remove icon"]').click()
    })
    expectNavigation(false)
    await refresh(() => setBlock({ ...savedBlock, iconUrl: '/api/files/serve/refreshed-icon' }))
    expect(container.querySelector('img')).toBeNull()
    expectNavigation(false)
    clickButton('Discard')
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/files/serve/refreshed-icon'
    )
    expectNavigation(true)
  })

  it('keeps an untouched creation form clean as eligible workspaces arrive', async () => {
    queryClient.setQueryData(workspaceKeys.list(), { workspaces: [] })
    await render(null)
    await refresh(() =>
      queryClient.setQueryData(workspaceKeys.list(), {
        workspaces: [
          { id: 'workspace-a', name: 'Workspace A', organizationId: 'org-a', permissions: 'write' },
          { id: 'workspace-b', name: 'Workspace B', organizationId: 'org-a', permissions: 'admin' },
        ],
      })
    )
    expectNavigation(true)
  })

  it('saves a text edit without deleting an icon added by a background refresh', async () => {
    let submitted: UpdateCustomBlockBody | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH' && typeof init.body === 'string') {
        submitted = updateCustomBlockBodySchema.parse(JSON.parse(init.body))
        return jsonResponse({ success: true })
      }
      return jsonResponse({ enabled: true, customBlocks: [savedBlock] })
    })
    await render()
    edit('input[placeholder="Invoice Parser"]', 'My draft')
    await refresh(() => setBlock({ ...savedBlock, iconUrl: '/api/files/serve/refreshed-icon' }))
    clickButton('Save')
    await act(async () => {
      await flushMicrotasks(10)
      await vi.runOnlyPendingTimersAsync()
    })
    expect(submitted).toEqual({
      name: 'My draft',
      description: 'Saved description',
      inputs: [],
      exposedOutputs: [{ blockId: 'result', path: 'response', name: 'response' }],
      traceChildRuns: false,
    })
    expect(departures).toBe(1)
  })

  it('retains unsaved edits and navigation protection when saving fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      init?.method === 'PATCH'
        ? jsonResponse({ error: 'Save rejected' }, 500)
        : jsonResponse({ enabled: true, customBlocks: [savedBlock] })
    )
    await render()
    edit('input[placeholder="Invoice Parser"]', 'My draft')
    clickButton('Save')
    await act(async () => {
      await flushMicrotasks(10)
      await vi.runOnlyPendingTimersAsync()
    })
    expect(departures).toBe(0)
    expect(field<HTMLInputElement>('input[placeholder="Invoice Parser"]').value).toBe('My draft')
    expectNavigation(false)
  })

  it('blocks discard and navigation during an icon upload, then allows discard after failure', async () => {
    const upload = createDeferred<never>()
    vi.spyOn(uploads, 'uploadInternalFileSession').mockImplementation(() => upload.promise)
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:pending-icon'
        }
        static revokeObjectURL() {}
      }
    )
    await render()
    edit('textarea', 'My draft')
    const picker = field<HTMLInputElement>('input[type="file"]')
    Object.defineProperty(picker, 'files', {
      value: [new File(['icon'], 'icon.png', { type: 'image/png' })],
    })
    act(() => {
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    clickButton('Custom blocks')
    expect(departures).toBe(0)
    act(() => {
      useSettingsDirtyStore.getState().requestLeave(() => {
        departures++
      })
    })
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
    const discard = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent?.trim() === 'Discard'
    )
    if (!discard) throw new Error('Missing discard action')
    expect(discard.disabled).toBe(true)
    act(() => {
      discard.click()
    })
    await refresh(() => setBlock({ ...savedBlock, description: 'Server update' }))
    await act(async () => {
      upload.reject(new Error('Upload rejected'))
      await flushMicrotasks(10)
      await vi.runOnlyPendingTimersAsync()
    })
    expect(field<HTMLTextAreaElement>('textarea').value).toBe('My draft')
    expectNavigation(false)
    clickButton('Discard')
    expect(field<HTMLTextAreaElement>('textarea').value).toBe('Server update')
    expectNavigation(true)
  })
})
