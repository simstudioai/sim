/**
 * @vitest-environment jsdom
 *
 * Sync confirms an overwrite, and the confirmation stays until the run's outcome is known.
 * Failure modes: the dialog closing as Sync is pressed, before the run commits, and closing on a
 * run the server refused.
 */
import { act } from 'react'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const forks = vi.hoisted(() => ({ sync: vi.fn() }))
vi.mock('@/platform/lib/data/settings-guard', () => ({
  useSettingsUnsavedGuard: () => ({ guardBack: (run: () => void) => run() }),
}))
vi.mock(
  '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-sync-view',
  () => ({ ForkSyncView: () => null })
)
vi.mock('@/platform/lib/data/forks', () => ({
  ARCHIVED_PREVIEW_LIMIT: 5,
  buildWebhookTriggerUrl: (path: string) => path,
  useForkSyncDirectionParam: () => ['pull', vi.fn()],
  useForkSync: () => ({
    targetWorkspaceName: 'Fork',
    saving: false,
    submitting: false,
    dirty: false,
    hasSessionChoices: false,
    syncDisabled: false,
    archivedWorkflowNames: [],
    triggerUrlChanges: [],
    discard: vi.fn(),
    save: vi.fn(),
    sync: forks.sync,
  }),
}))

import { ForkSyncDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-sync-detail'
import type { ForkLineageNodeApi } from '@/platform/lib/data/forks'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  forks.sync.mockReset()
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const parent = { id: 'parent', name: 'Parent', viewerAccessible: true } as ForkLineageNodeApi
const openDialog = () => document.querySelector('dialog[open]')

async function confirmSync() {
  act(() =>
    root.render(
      <ForkSyncDetail
        workspaceId='ws'
        parent={parent}
        onBack={() => undefined}
        onOpenWorkspace={() => undefined}
      />
    )
  )
  const sync = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Sync')
  await act(async () => sync?.click())
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
    (button) => button.textContent === 'Sync'
  )
  await act(async () => confirm?.click())
}

it('holds the confirmation until the sync commits, then closes it', async () => {
  const run = createDeferred<boolean>()
  forks.sync.mockReturnValue(run.promise)
  await confirmSync()
  expect(openDialog()).not.toBeNull()
  await act(async () => run.resolve(true))
  expect(openDialog()).toBeNull()
})

it('keeps the confirmation open when the sync does not commit', async () => {
  forks.sync.mockResolvedValue(false)
  await confirmSync()
  expect(openDialog()).not.toBeNull()
})
