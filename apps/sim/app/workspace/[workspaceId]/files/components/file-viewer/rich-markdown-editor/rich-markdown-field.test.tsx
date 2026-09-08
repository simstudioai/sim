/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
import { PASTE_LIMITS, PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import type { Editor } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RichMarkdownField } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention',
  () => ({
    useEditorMentions: vi.fn(),
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu',
  () => ({
    EditorBubbleMenu: () => null,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-hover-card',
  () => ({
    LinkHoverCard: () => null,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/image-menu',
  () => ({ ImageBubbleMenu: () => null })
)

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(toast, 'warning').mockReturnValue('paste-warning')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('shared field paste admission with real extensions', () => {
  it.each([false, true])('counts preserved frontmatter (near limit=%s)', async (nearLimit) => {
    const frontmatter = `---\ndescription: ${'f'.repeat(nearLimit ? 900 : 10)}\n---\n\n`
    const body = 'x'.repeat(PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS - 1000)
    const onChange = vi.fn()
    await act(async () =>
      root.render(<RichMarkdownField value={frontmatter + body} onChange={onChange} />)
    )
    const element = container.querySelector<HTMLElement & { editor: Editor }>('.tiptap')
    expect(element).not.toBeNull()
    const editor = element!.editor
    await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1))
    const before = editor.getJSON()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [],
        items: [],
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'y'.repeat(100) : ''),
      },
    })
    await act(async () => element!.dispatchEvent(event))
    if (nearLimit) {
      expect(editor.getJSON()).toEqual(before)
      expect(onChange).not.toHaveBeenCalled()
      expect(toast.warning).toHaveBeenCalledOnce()
    } else {
      expect(onChange).toHaveBeenCalledOnce()
      expect(onChange.mock.lastCall?.[0]).toContain(frontmatter.trim())
      expect(new TextEncoder().encode(onChange.mock.lastCall?.[0]).byteLength).toBeLessThanOrEqual(
        PASTE_LIMITS.RICH_MARKDOWN_BYTES
      )
      expect(onChange.mock.lastCall?.[0].length).toBeLessThanOrEqual(
        PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS
      )
      expect(editor.getText()).toBe(body + 'y'.repeat(100))
      expect(toast.warning).not.toHaveBeenCalled()
    }
  })
})
