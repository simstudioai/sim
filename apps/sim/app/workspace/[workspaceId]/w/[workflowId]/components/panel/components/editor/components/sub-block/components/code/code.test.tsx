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

const { SECRET, searchTargetRef } = vi.hoisted(() => ({
  SECRET: 'SIM-TEST-CREDENTIAL-MARKER\nfixture-body-abc123\nend-of-fixture',
  searchTargetRef: { current: null as Record<string, unknown> | null },
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
  () => ({ useActiveSearchTarget: () => searchTargetRef.current })
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
  searchTargetRef.current = null
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

/** A live workflow-search hit on the base64 body of the secret. */
const SECRET_MATCH = 'fixture-body-abc123'
const SECRET_MATCH_START = SECRET.indexOf(SECRET_MATCH)
const SECRET_SEARCH_TARGET = {
  subBlockId: 'privateKey',
  targetKind: 'subblock',
  valuePath: [],
  query: SECRET_MATCH,
  rawValue: SECRET_MATCH,
  range: { start: SECRET_MATCH_START, end: SECRET_MATCH_START + SECRET_MATCH.length },
}

describe('Code password masking', () => {
  it('conceals the editor contents while unfocused', () => {
    mount(true)

    expect(highlighted()).not.toContain('SIM-TEST-CREDENTIAL-MARKER')
    expect(highlighted()).not.toContain('b3BlbnNzaC1rZXktdjE')
    expect(highlighted()).toContain('•')
  })

  it('reveals the contents once the editor takes focus and re-masks on blur', () => {
    mount(true)

    const textarea = container.querySelector('[data-testid="code-textarea"]') as HTMLTextAreaElement
    act(() => {
      textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(highlighted()).toContain('SIM-TEST-CREDENTIAL-MARKER')

    act(() => {
      textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(highlighted()).not.toContain('SIM-TEST-CREDENTIAL-MARKER')
  })

  it('leaves a non-password code field in plaintext', () => {
    mount(false)

    expect(highlighted()).toContain('SIM-TEST-CREDENTIAL-MARKER')
    expect(highlighted()).not.toContain('•')
  })

  it('stays concealed while workflow search targets a match inside the secret', () => {
    searchTargetRef.current = SECRET_SEARCH_TARGET

    mount(true)

    expect(highlighted()).not.toContain('b3BlbnNzaC1rZXktdjE')
    expect(highlighted()).not.toContain('SIM-TEST-CREDENTIAL-MARKER')
    expect(highlighted()).toContain('•')
  })

  it('highlights a targeted match when the field holds no secret', () => {
    searchTargetRef.current = SECRET_SEARCH_TARGET

    mount(false)

    expect(highlighted()).toContain('<mark')
    expect(highlighted()).toContain(SECRET_MATCH)
  })
})
