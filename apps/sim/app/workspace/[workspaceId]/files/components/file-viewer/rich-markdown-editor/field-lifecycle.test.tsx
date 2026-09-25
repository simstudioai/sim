/** @vitest-environment jsdom */
import { act, Suspense, startTransition } from 'react'
import type { Editor } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RichMarkdownField } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention',
  () => ({ useEditorMentions: vi.fn() })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu',
  () => ({ EditorBubbleMenu: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-hover-card',
  () => ({ LinkHoverCard: () => null })
)

let host: HTMLDivElement
let root: Root
const pending = new Promise<void>(() => {})
const suspended = vi.fn()
interface BlockerProps {
  active: boolean
}

function Blocker({ active }: BlockerProps) {
  if (active) {
    suspended()
    throw pending
  }
  return null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  suspended.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  await vi.advanceTimersByTimeAsync(10)
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('field callbacks remain tied to the committed render', () => {
  for (const action of ['edit', 'upload'] as const)
    for (const suspend of [false, true]) {
      it(`${action}, suspended=${suspend}`, async () => {
        const originalChange = vi.fn()
        const nextChange = vi.fn()
        const originalUpload = vi.fn().mockResolvedValue(null)
        const nextUpload = vi.fn().mockResolvedValue(null)
        const render = (next: boolean) =>
          root.render(
            <Suspense fallback='Waiting'>
              <RichMarkdownField
                value='body'
                onChange={next ? nextChange : originalChange}
                uploadImage={next ? nextUpload : originalUpload}
              />
              <Blocker active={next && suspend} />
            </Suspense>
          )
        await act(async () => render(false))
        await act(async () => vi.advanceTimersByTimeAsync(10))
        const owner = host.querySelector<HTMLElement & { editor: Editor }>('.tiptap')!.editor
        await act(async () => {
          if (suspend) startTransition(() => render(true))
          else render(true)
        })
        if (suspend) expect(suspended).toHaveBeenCalled()
        expect(host.querySelector<HTMLElement & { editor: Editor }>('.tiptap')!.editor).toBe(owner)
        expect(owner.getText()).toBe('body')
        if (action === 'edit') await act(async () => owner.commands.insertContentAt(1, 'typed '))
        else {
          const event = new Event('paste', { bubbles: true, cancelable: true })
          Object.defineProperty(event, 'clipboardData', {
            value: {
              files: [new File(['image'], 'image.png', { type: 'image/png' })],
              items: [],
              types: ['Files'],
              getData: () => '',
            },
          })
          await act(async () => owner.view.dom.dispatchEvent(event))
        }
        const original = action === 'edit' ? originalChange : originalUpload
        const next = action === 'edit' ? nextChange : nextUpload
        expect({ committed: original.mock.calls.length, next: next.mock.calls.length }).toEqual(
          suspend ? { committed: 1, next: 0 } : { committed: 0, next: 1 }
        )
      })
    }

  it('ignores completion after React unmount before TipTap delayed destruction', async () => {
    const change = vi.fn()
    const pendingUpload = Promise.withResolvers<{ url: string; alt: string } | null>()
    await act(async () =>
      root.render(
        <RichMarkdownField
          value='body'
          onChange={change}
          uploadImage={() => pendingUpload.promise}
        />
      )
    )
    await act(async () => vi.advanceTimersByTimeAsync(10))
    const owner = host.querySelector<HTMLElement & { editor: Editor }>('.tiptap')!.editor
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [new File(['image'], 'image.png', { type: 'image/png' })],
        items: [],
        types: ['Files'],
        getData: () => '',
      },
    })
    await act(async () => owner.view.dom.dispatchEvent(event))
    const before = owner.getJSON()
    await act(async () => root.render(null))
    expect(owner.isDestroyed).toBe(false)
    await act(async () => pendingUpload.resolve({ url: 'https://sim.ai/image.png', alt: 'late' }))
    expect(owner.getJSON()).toEqual(before)
    expect(change).not.toHaveBeenCalled()
  })
})
