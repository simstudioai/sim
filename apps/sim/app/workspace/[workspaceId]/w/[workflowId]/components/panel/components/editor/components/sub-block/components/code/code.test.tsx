/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** jsdom ships no ResizeObserver; the editor observes its container to size the gutter. */
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const { SECRET } = vi.hoisted(() => ({
  SECRET: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE\n-----END-----',
}))

vi.mock('@sim/emcn', () => ({
  CODE_LINE_HEIGHT_PX: 21,
  Code: {
    Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Gutter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Content: ({
      children,
      editorRef,
    }: {
      children: ReactNode
      editorRef?: React.RefObject<HTMLDivElement | null>
    }) => <div ref={editorRef}>{children}</div>,
    Placeholder: ({ children, show }: { children: ReactNode; show: boolean }) =>
      show ? <div>{children}</div> : null,
  },
  calculateGutterWidth: () => 24,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Duplicate: () => null,
  getCodeEditorProps: () => ({}),
  highlight: (code: string) => code,
  languages: { javascript: {}, python: {}, bash: {} },
}))

vi.mock('@sim/emcn/icons', () => ({
  Check: () => null,
  Wand: () => null,
}))

vi.mock('react-simple-code-editor', () => ({
  default: ({
    value,
    highlight,
    onFocus,
    onBlur,
  }: {
    value: string
    highlight: (code: string) => string
    onFocus: () => void
    onBlur: () => void
  }) => (
    <>
      <textarea
        data-testid='code-textarea'
        value={value}
        readOnly
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <pre data-testid='code-highlight' dangerouslySetInnerHTML={{ __html: highlight(value) }} />
    </>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type='button'>{children}</button>,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown',
  () => ({
    EnvVarDropdown: () => null,
    checkEnvVarTrigger: () => ({ show: false, searchTerm: '' }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown',
  () => ({
    TagDropdown: () => null,
    checkTagTrigger: () => ({ show: false }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (_blockId: string, subBlockId: string) => [
      subBlockId === 'privateKey' ? SECRET : undefined,
      () => {},
    ],
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({ useActiveSearchTarget: () => null })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar',
  () => ({
    WandPromptBar: () => null,
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes',
  () => ({ useAccessibleReferencePrefixes: () => undefined })
)

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand', () => ({
  useWand: () => ({
    isLoading: false,
    isStreaming: false,
    isPromptVisible: false,
    promptInputValue: '',
    generateStream: () => {},
    cancelGeneration: () => {},
    showPromptInline: () => {},
    hidePromptInline: () => {},
    updatePromptValue: () => {},
  }),
}))

vi.mock('@/hooks/kb/use-tag-selection', () => ({ useTagSelection: () => () => {} }))

vi.mock('@/hooks/use-available-env-vars', () => ({
  useAvailableEnvVarKeys: () => [],
  createShouldHighlightEnvVar: () => () => false,
}))

vi.mock('@/hooks/use-code-undo-redo', () => ({
  useCodeUndoRedo: () => ({
    recordChange: () => {},
    recordReplace: () => {},
    flushPending: () => {},
    startSession: () => {},
    undo: () => {},
    redo: () => {},
  }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: { blocks: Record<string, unknown> }) => unknown) =>
    selector({ blocks: {} }),
}))

import { Code } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/code'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(password: boolean) {
  act(() => {
    root.render(
      <Code
        blockId='block-1'
        subBlockId='privateKey'
        password={password}
        wandConfig={{ enabled: false, prompt: '' }}
      />
    )
  })
}

const highlighted = () => container.querySelector('[data-testid="code-highlight"]')?.innerHTML ?? ''

describe('Code password masking', () => {
  it('conceals the editor contents while unfocused', () => {
    mount(true)

    expect(highlighted()).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(highlighted()).not.toContain('b3BlbnNzaC1rZXktdjE')
    expect(highlighted()).toContain('•')
  })

  it('reveals the contents once the editor takes focus and re-masks on blur', () => {
    mount(true)

    const textarea = container.querySelector('[data-testid="code-textarea"]') as HTMLTextAreaElement
    act(() => {
      textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(highlighted()).toContain('BEGIN OPENSSH PRIVATE KEY')

    act(() => {
      textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(highlighted()).not.toContain('BEGIN OPENSSH PRIVATE KEY')
  })

  it('leaves a non-password code field in plaintext', () => {
    mount(false)

    expect(highlighted()).toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(highlighted()).not.toContain('•')
  })
})
