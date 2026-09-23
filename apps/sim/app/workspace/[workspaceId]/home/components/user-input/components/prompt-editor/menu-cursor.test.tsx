/** @vitest-environment jsdom */
import { act, type ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/skills', () => ({ useSkills: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpToolServers: () => ({ data: [] }) }))
vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
}))

import { PromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/prompt-editor'
import { usePromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown',
  () => ({ PlusMenuDropdown: () => null })
)

const skill = {
  id: 'builtin-research',
  workspaceId: null,
  userId: null,
  name: 'research',
  description: '',
  content: '',
  canEdit: false,
  createdAt: '',
  updatedAt: '',
}

it.each([
  ['', 'keyboard'],
  ['tail', 'keyboard'],
  ['', 'pointer'],
  ['tail', 'pointer'],
  ['', 'pointer-restores-caret'],
] as const)(
  'keeps the caret after the selected skill (%s, %s)',
  async (suffix, selectionMethod) => {
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
    const originalScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let editor!: ReturnType<typeof usePromptEditor>
    function Probe() {
      editor = usePromptEditor({
        workspaceId: '',
        organizationId: 'org-1',
        initialValue: suffix,
        availableSkills: [skill],
      })
      return (
        <>
          <PromptEditor editor={editor} />
          <button type='button' onClick={editor.insertSlashTrigger}>
            Skills
          </button>
        </>
      )
    }
    try {
      await act(async () => root.render(<Probe />))
      editor.textareaRef.current!.setSelectionRange(0, 0)
      if (selectionMethod.startsWith('pointer')) {
        const toolbar = container.querySelector<HTMLButtonElement>('button')!
        act(() => {
          toolbar.focus()
          toolbar.click()
        })
      } else {
        act(() => editor.skillsMenuRef.current?.open({ left: 0, top: 0 }))
      }
      act(() => vi.runOnlyPendingTimers())
      if (selectionMethod.startsWith('pointer')) {
        const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
          (item) => item.textContent === 'research'
        )!
        if (selectionMethod === 'pointer-restores-caret') {
          const textarea = editor.textareaRef.current!
          const focus = textarea.focus.bind(textarea)
          // Browser focus recovery can restore the textarea's pre-menu caret.
          vi.spyOn(textarea, 'focus').mockImplementation((options) => {
            focus(options)
            textarea.setSelectionRange(0, 0)
          })
        }
        act(() => {
          item.focus()
          item.click()
        })
        act(() => vi.runOnlyPendingTimers())
        expect(editor.textareaRef.current!.selectionStart).toBe(10)
        expect(document.activeElement).toBe(editor.textareaRef.current)
      } else {
        act(() => {
          editor.skillsMenuRef.current?.selectActive()
        })
      }
      const textarea = editor.textareaRef.current!
      act(() => {
        textarea.setRangeText('R', textarea.selectionStart, textarea.selectionEnd, 'end')
        editor.handleInputChange({ target: textarea } as ChangeEvent<HTMLTextAreaElement>)
      })
      const positionAfterTyping = textarea.selectionStart
      act(() => vi.runOnlyPendingTimers())
      expect(textarea.selectionStart).toBe(positionAfterTyping)
      expect(editor.getPlainValue()).toBe(`/research R${suffix}`)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      Element.prototype.scrollIntoView = originalScroll
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  }
)
