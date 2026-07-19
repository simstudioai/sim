/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/skills', () => ({ useSkills: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpServers: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/tables', () => ({ useTablesList: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/kb/knowledge', () => ({ useKnowledgeBasesQuery: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/folders', () => ({ useFolders: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/workspace-file-folders', () => ({
  useWorkspaceFileFolders: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({ useMothershipChats: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/schedules', () => ({ useWorkspaceSchedules: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/logs', () => ({ useLogsList: () => ({ data: undefined }) }))
vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
  listIntegrations: () => [],
}))

import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import {
  type UsePromptEditorProps,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'
import type { SkillsMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/skills-menu-dropdown'

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
      selectActive: vi.fn(() => false),
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
