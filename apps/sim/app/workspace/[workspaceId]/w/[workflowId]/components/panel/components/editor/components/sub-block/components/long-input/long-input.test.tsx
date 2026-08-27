/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { SECRET, searchTargetRef } = vi.hoisted(() => ({
  SECRET: 'SIM-TEST-CREDENTIAL-MARKER\nfixture-body-abc\nend-of-fixture',
  searchTargetRef: { current: null as Record<string, unknown> | null },
}))

vi.mock('@sim/emcn', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}))

vi.mock('@sim/emcn/icons', () => ({
  ChevronsUpDown: () => null,
  Wand: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type='button'>{children}</button>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller',
  () => ({
    SubBlockInputController: ({
      children,
    }: {
      children: (props: Record<string, unknown>) => React.ReactNode
    }) =>
      children({
        ref: { current: null },
        onChange: () => {},
        onKeyDown: () => {},
        onDrop: () => {},
        onDragOver: () => {},
        onFocus: () => {},
      }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input',
  () => ({
    useSubBlockInput: () => ({ valueString: SECRET }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: () => [SECRET, () => {}],
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({
    useActiveSearchTarget: () => searchTargetRef.current,
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar',
  () => ({
    WandPromptBar: () => null,
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes',
  () => ({
    useAccessibleReferencePrefixes: () => undefined,
  })
)

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand', () => ({
  useWand: () => ({
    isStreaming: false,
    isLoading: false,
    isPromptVisible: false,
    promptInputValue: '',
    generateStream: () => {},
    cancelGeneration: () => {},
    hidePromptInline: () => {},
    showPromptInline: () => {},
    updatePromptValue: () => {},
  }),
}))

import { LongInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/long-input'
import type { SubBlockConfig } from '@/blocks/types'

const config: SubBlockConfig = { id: 'privateKey', type: 'long-input', password: true }

/** A live workflow-search hit on the base64 body of the secret. */
const SECRET_MATCH = 'fixture-body-abc'
const MATCH_START = SECRET.indexOf(SECRET_MATCH)

function render(password: boolean) {
  return renderToStaticMarkup(
    <LongInput blockId='block-1' subBlockId='privateKey' config={config} password={password} />
  )
}

describe('LongInput password masking', () => {
  beforeEach(() => {
    searchTargetRef.current = null
  })

  it('conceals the value in both the textarea and the overlay when unfocused', () => {
    const html = render(true)

    expect(html).not.toContain('SIM-TEST-CREDENTIAL-MARKER')
    expect(html).not.toContain('b3BlbnNzaC1rZXk')
    expect(html).toContain('•')
  })

  it('renders the plaintext value when the field is not a password field', () => {
    const html = render(false)

    expect(html).toContain('SIM-TEST-CREDENTIAL-MARKER')
    expect(html).not.toContain('•')
  })

  it('stays concealed while workflow search targets a match inside the secret', () => {
    searchTargetRef.current = {
      blockId: 'block-1',
      subBlockId: 'privateKey',
      targetKind: 'subblock',
      valuePath: [],
      query: SECRET_MATCH,
      rawValue: SECRET_MATCH,
      range: { start: MATCH_START, end: MATCH_START + SECRET_MATCH.length },
    }

    const html = render(true)

    expect(html).not.toContain('b3BlbnNzaC1rZXk')
    expect(html).not.toContain('SIM-TEST-CREDENTIAL-MARKER')
    expect(html).toContain('•')
  })

  it('highlights a workflow-search match when the field holds no secret', () => {
    searchTargetRef.current = {
      blockId: 'block-1',
      subBlockId: 'privateKey',
      targetKind: 'subblock',
      valuePath: [],
      query: SECRET_MATCH,
      rawValue: SECRET_MATCH,
      range: { start: MATCH_START, end: MATCH_START + SECRET_MATCH.length },
    }

    const html = render(false)

    expect(html).toContain('<mark')
    expect(html).toContain(SECRET_MATCH)
  })
})
