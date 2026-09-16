/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/skills', () => ({ useSkills: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpToolServers: () => ({ data: [] }) }))
vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
}))

import { SIM_SELECTION_MIME } from '@/lib/copilot/chat/selection-clipboard'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import {
  type UsePromptEditorProps,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'
import type { SkillsMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/skills-menu-dropdown'
import type { ChatContext } from '@/stores/panel'

function selectionPayload(context: ChatContext, sourceWorkspaceId = 'ws-1'): string {
  return JSON.stringify({ version: 1, sourceWorkspaceId, context })
}

/**
 * Mounts `usePromptEditor` in a real React 19 root under jsdom (no
 * `@testing-library/react` in this repo — see `hooks/queries/unsubscribe.test.tsx`
 * for the established pattern) and wires a real `<textarea>` into its
 * `textareaRef` so selection/caret-driven behavior (`handleSelectAdjust`,
 * `syncMentionState`) runs exactly as it does in the rendered `PromptEditor`.
 */
function renderPromptEditor(props: UsePromptEditorProps) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let latest: ReturnType<typeof usePromptEditor>

  function Probe() {
    latest = usePromptEditor(props)
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <>{children}</>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })

  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  latest!.textareaRef.current = textarea

  return {
    result: () => latest,
    textarea,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
      textarea.remove()
    },
  }
}

/** Fires a native `input` event carrying the new value, as the textarea would on a keystroke. */
function typeInto(textarea: HTMLTextAreaElement, value: string, caret = value.length) {
  textarea.value = value
  textarea.setSelectionRange(caret, caret)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('usePromptEditor mention menu dismissal', () => {
  let openMenu: PlusMenuHandle

  beforeEach(() => {
    openMenu = {
      open: vi.fn(),
      close: vi.fn(),
      moveActive: vi.fn(),
      selectActive: vi.fn(() => 'empty' as const),
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reopens the menu while the user keeps typing an unmatched mention', () => {
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    result().plusMenuRef.current = openMenu

    act(() => {
      typeInto(textarea, '@f')
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
    })

    expect(result().mentionQuery).toBe('f')
    expect(openMenu.open).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('stays closed across repeated clicks at the same position after the user clicks away, even if the caret lands back inside the open mention', () => {
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    result().plusMenuRef.current = openMenu

    act(() => {
      typeInto(textarea, '@f')
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
    })
    expect(result().mentionQuery).toBe('f')

    act(() => {
      result().handlePlusMenuClose()
    })
    expect(result().mentionQuery).toBeNull()

    for (let i = 0; i < 3; i++) {
      act(() => {
        textarea.setSelectionRange(2, 2)
        result().handleSelectAdjust()
      })
    }

    expect(result().mentionQuery).toBeNull()
    expect(openMenu.open).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('lets a further keystroke reopen the same mention after a dismiss', () => {
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    result().plusMenuRef.current = openMenu

    act(() => {
      typeInto(textarea, '@f')
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
    })
    act(() => {
      result().handlePlusMenuClose()
    })
    act(() => {
      textarea.setSelectionRange(2, 2)
      result().handleSelectAdjust()
    })
    expect(openMenu.open).toHaveBeenCalledTimes(1)

    act(() => {
      typeInto(textarea, '@fo', 3)
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
    })

    expect(result().mentionQuery).toBe('fo')
    expect(openMenu.open).toHaveBeenCalledTimes(2)

    unmount()
  })

  it('does not suppress a different mention typed after a dismiss', () => {
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    result().plusMenuRef.current = openMenu

    act(() => {
      typeInto(textarea, '@f')
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
    })
    act(() => {
      result().handlePlusMenuClose()
    })
    act(() => {
      textarea.setSelectionRange(2, 2)
      result().handleSelectAdjust()
    })
    expect(openMenu.open).toHaveBeenCalledTimes(1)

    act(() => {
      typeInto(textarea, '@f done. @g', 11)
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
    })

    expect(result().mentionQuery).toBe('g')
    expect(openMenu.open).toHaveBeenCalledTimes(2)

    unmount()
  })
})

describe('usePromptEditor toolbar slash trigger after a dismiss', () => {
  it('still opens the skills menu when the caret sits at the start of the previously dismissed token', () => {
    const skillsMenu: SkillsMenuHandle = {
      open: vi.fn(),
      close: vi.fn(),
      moveActive: vi.fn(),
      selectActive: vi.fn(() => false),
    }
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    result().skillsMenuRef.current = skillsMenu

    act(() => {
      result().insertSlashTrigger()
    })
    expect(skillsMenu.open).toHaveBeenCalledTimes(1)

    act(() => {
      result().handleSkillsMenuClose()
    })

    act(() => {
      textarea.setSelectionRange(0, 0)
      result().insertSlashTrigger()
    })

    expect(skillsMenu.open).toHaveBeenCalledTimes(2)

    unmount()
  })
})

describe('usePromptEditor context insertion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appends a real mention token and context, then focuses the editor', () => {
    const onContextAdd = vi.fn()
    let focusFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      focusFrame = callback
      return 1
    })
    const context = {
      kind: 'terminal_tab',
      terminalId: 'terminal-1',
      label: 'Terminal (L9-11)',
      selection: { text: 'selected output', startLine: 9, endLine: 11 },
    } satisfies ChatContext
    const { result, textarea, unmount } = renderPromptEditor({
      workspaceId: 'ws-1',
      initialValue: 'Explain this',
      onContextAdd,
    })

    act(() => {
      result().insertContext(context)
    })

    expect(result().value).toBe('Explain this @Terminal (L9-11) ')
    expect(result().contexts).toEqual([context])
    expect(onContextAdd).toHaveBeenCalledWith(context)

    textarea.value = result().value
    act(() => focusFrame?.(0))
    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe(textarea.value.length)
    expect(textarea.selectionEnd).toBe(textarea.value.length)

    unmount()
  })

  it('pastes a large table selection as a compact context chip', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const context = {
      kind: 'table_selection',
      tableId: 'table-1',
      tableName: 'Large table',
      rowIds: ['row-1'],
      label: 'Large table (1 row)',
    } satisfies ChatContext
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    const preventDefault = vi.fn()

    act(() => {
      result().handlePaste({
        currentTarget: textarea,
        clipboardData: {
          getData: (type: string) => {
            if (type === 'text/plain') return 'x'.repeat(1_000_001)
            if (type === SIM_SELECTION_MIME) return selectionPayload(context)
            return ''
          },
        },
        preventDefault,
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
    })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(result().value).toBe('@Large table (1 row) ')
    expect(result().contexts).toEqual([context])

    unmount()
  })

  it('leaves a cross-workspace selection to the ordinary plain-text paste path', () => {
    const context = {
      kind: 'file_selection',
      fileId: 'file-1',
      fileName: 'notes.md',
      label: 'notes.md:1',
      text: 'ordinary text',
    } satisfies ChatContext
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-2' })
    const preventDefault = vi.fn()

    act(() => {
      result().handlePaste({
        currentTarget: textarea,
        clipboardData: {
          getData: (type: string) => {
            if (type === 'text/plain') return context.text
            if (type === SIM_SELECTION_MIME) return selectionPayload(context)
            return ''
          },
        },
        preventDefault,
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(result().contexts).toEqual([])

    unmount()
  })

  it('suffixes duplicate visible labels so two browser selections coexist', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const first = {
      kind: 'browser_tab',
      tabId: 'tab-1',
      label: 'Browser · Example page title',
      selection: { text: 'first selection', url: 'https://example.com' },
    } satisfies ChatContext
    const second = {
      kind: 'browser_tab',
      tabId: 'tab-1',
      label: 'Browser · Another page title',
      selection: { text: 'second selection', url: 'https://example.com' },
    } satisfies ChatContext
    const { result, textarea, unmount } = renderPromptEditor({
      workspaceId: 'ws-1',
    })

    act(() => {
      result().insertContext(first)
    })
    act(() => {
      result().insertContext(second)
    })

    expect(result().value).toBe('@Browser @Browser (1) ')
    expect(result().contexts).toEqual([
      { ...first, label: 'Browser' },
      { ...second, label: 'Browser (1)' },
    ])

    let contextsAtSubmit: ChatContext[] = []
    act(() => {
      typeInto(textarea, '@Browser (1) ')
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
      contextsAtSubmit = result().getActiveContexts()
    })
    expect(contextsAtSubmit).toEqual([{ ...second, label: 'Browser (1)' }])

    unmount()
  })

  it('excludes a deleted chip from submission before the cleanup effect runs', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const context = {
      kind: 'browser_tab',
      tabId: 'tab-1',
      label: 'Browser',
      selection: { text: 'selected text', url: 'https://example.com' },
    } satisfies ChatContext
    const { result, textarea, unmount } = renderPromptEditor({
      workspaceId: 'ws-1',
      initialValue: 'Explain this',
    })

    act(() => result().insertContext(context))

    let contextsAtSubmit: ChatContext[] = []
    act(() => {
      typeInto(textarea, 'Explain this')
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
      contextsAtSubmit = result().getActiveContexts()
    })

    expect(contextsAtSubmit).toEqual([])
    unmount()
  })
})

describe('folder resource mention identity', () => {
  it('retains distinct folder IDs and labels when inserting a batch', () => {
    const { result, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    try {
      act(() =>
        result().insertResources([
          { type: 'folder', id: 'workflow-folder', title: 'Planning' },
          { type: 'folder', id: 'table-folder', title: 'Planning' },
          { type: 'folder', id: 'knowledge-folder', title: 'Planning' },
          { type: 'filefolder', id: 'file-folder', title: 'Planning' },
          { type: 'folder', id: 'table-folder', title: 'Planning' },
        ])
      )
      expect(result().contexts).toEqual([
        { kind: 'folder', folderId: 'workflow-folder', label: 'Planning' },
        { kind: 'folder', folderId: 'table-folder', label: 'Planning (2)' },
        { kind: 'folder', folderId: 'knowledge-folder', label: 'Planning (3)' },
        { kind: 'filefolder', fileFolderId: 'file-folder', label: 'Planning (4)' },
      ])
      expect(result().value).toBe(
        '@Planning @Planning (2) @Planning (3) @Planning (4) @Planning (2) '
      )
    } finally {
      unmount()
    }
  })

  it('keeps same-named folders as separate chips and reuses the label for a repeated ID', () => {
    const { result, unmount } = renderPromptEditor({ workspaceId: 'ws-1' })
    try {
      act(() =>
        result().insertResource({ type: 'folder', id: 'workflow-folder', title: 'Planning' })
      )
      act(() => result().insertResource({ type: 'folder', id: 'table-folder', title: 'Planning' }))
      act(() =>
        result().insertResource({ type: 'folder', id: 'knowledge-folder', title: 'Planning' })
      )
      act(() => result().insertResource({ type: 'folder', id: 'table-folder', title: 'Planning' }))
      expect(result().contexts).toEqual([
        { kind: 'folder', folderId: 'workflow-folder', label: 'Planning' },
        { kind: 'folder', folderId: 'table-folder', label: 'Planning (2)' },
        { kind: 'folder', folderId: 'knowledge-folder', label: 'Planning (3)' },
      ])
      expect(result().value).toContain('@Planning (2)')
      expect(result().value).toContain('@Planning (3)')
    } finally {
      unmount()
    }
  })
})
