/**
 * @vitest-environment jsdom
 *
 * A knowledge base's tags are readable by anyone who can open it, but only an editor creates or
 * deletes one. Failure mode: a read-only viewer offered New tag and Delete tag, which the server
 * refuses.
 */
import { act } from 'react'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/platform/lib/data/knowledge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCreateTagDefinition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTagDefinition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTagDefinitionsQuery: () => ({
    status: 'success',
    data: [{ id: 'tag-1', displayName: 'Region', fieldType: 'text', tagSlot: 'tag1' }],
  }),
  useTagUsageQuery: () => ({ data: [], refetch: vi.fn() }),
}))

import { BaseTagsModal } from '@/app/(product)/_components/workspace/knowledge/base-tags-modal/base-tags-modal'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function offered(canEdit: boolean) {
  act(() =>
    root.render(
      <BaseTagsModal open onOpenChange={() => undefined} knowledgeBaseId='kb' canEdit={canEdit} />
    )
  )
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Region options"]')
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      trigger?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
  })
  return [
    ...[...document.querySelectorAll('dialog[open] button')].map((button) => button.textContent),
    ...[...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
  ]
}

it('offers New tag and Delete tag only to an editor', async () => {
  const reader = await offered(false)
  expect(reader).toContain('View documents')
  expect(reader).not.toContain('New tag')
  expect(reader).not.toContain('Delete tag')
})

it('still offers both to an editor', async () => {
  const editor = await offered(true)
  expect(editor).toContain('New tag')
  expect(editor).toContain('Delete tag')
})
