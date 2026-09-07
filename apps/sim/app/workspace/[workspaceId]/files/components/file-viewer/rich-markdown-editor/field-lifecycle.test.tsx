/** @vitest-environment jsdom */
import { act, type ComponentProps, StrictMode, Suspense, startTransition } from 'react'
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
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/image-menu',
  () => ({ ImageBubbleMenu: () => null })
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

describe('editability synchronization', () => {
  async function renderField(props: ComponentProps<typeof RichMarkdownField>) {
    await act(async () =>
      root.render(
        <StrictMode>
          <RichMarkdownField {...props} />
        </StrictMode>
      )
    )
    await act(async () => vi.advanceTimersByTimeAsync(10))
    return host.querySelector<HTMLElement & { editor: Editor }>('.tiptap')!.editor
  }

  it.each([
    { label: 'start streaming', initial: {}, next: { isStreaming: true, value: 'streamed' } },
    {
      label: 'finish streaming',
      initial: { isStreaming: true },
      next: { isStreaming: false, value: 'final' },
    },
    { label: 'disable', initial: {}, next: { disabled: true } },
    { label: 'enable', initial: { disabled: true }, next: { disabled: false } },
  ])('does not report a local edit when props $label', async ({ initial, next }) => {
    const props = { value: 'body', onChange: vi.fn(), ...initial }
    const owner = await renderField(props)
    props.onChange.mockClear()
    expect(await renderField({ ...props, ...next })).toBe(owner)
    expect(owner.getText()).toBe(next.value ?? 'body')
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('continues reporting actual edits after streaming completes', async () => {
    const props = { value: 'body', onChange: vi.fn(), isStreaming: true }
    const owner = await renderField(props)
    await renderField({ ...props, value: 'final', isStreaming: false })
    props.onChange.mockClear()
    await act(async () =>
      owner.commands.insertContentAt(owner.state.doc.content.size - 1, ' edited')
    )
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith('final edited')
  })

  it('continues reporting successful uploads after editability changes', async () => {
    const pending = Promise.withResolvers<{ url: string; alt: string }>()
    const props = {
      value: 'body',
      onChange: vi.fn(),
      disabled: true,
      uploadImage: vi.fn(() => pending.promise),
    }
    const owner = await renderField(props)
    await renderField({ ...props, disabled: false })
    props.onChange.mockClear()
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
    await act(async () => pending.resolve({ url: 'https://sim.ai/valid.png', alt: 'valid' }))
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('valid')
    expect(props.onChange).toHaveBeenCalledOnce()
    expect(props.onChange.mock.calls[0][0]).toContain('https://sim.ai/valid.png')
  })
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
