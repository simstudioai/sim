import { emcnIconsMock } from '@sim/testing/mocks/emcn-icons.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { SECRET, searchTargetRef } = vi.hoisted(() => ({
  SECRET: 'SIM-TEST-CREDENTIAL-MARKER\nfixture-body-abc\nend-of-fixture',
  searchTargetRef: { current: null as Record<string, unknown> | null },
}))

vi.mock('@sim/emcn-legacy', () => ({
  Chip: ({
    onClick,
    disabled,
    'aria-label': label,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' onClick={onClick} disabled={disabled} aria-label={label} />
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}))

vi.mock('@sim/emcn-legacy/icons', () => emcnIconsMock)

vi.mock(
  '@/components/workflow-editor/components/panel/components/editor/components/sub-block/components/sub-block-input-controller',
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
  '@/components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input',
  () => ({
    useSubBlockInput: () => ({ valueString: SECRET }),
  })
)

vi.mock(
  '@/components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: () => [SECRET, () => {}],
  })
)

vi.mock(
  '@/components/workflow-editor/components/panel/components/editor/providers/active-search-target-provider',
  () => ({
    useActiveSearchTarget: () => searchTargetRef.current,
  })
)

vi.mock('@/components/workflow-editor/components/wand-prompt-bar/wand-prompt-bar', () => ({
  WandPromptBar: () => null,
}))

vi.mock('@/components/workflow-editor/hooks/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => undefined,
}))

vi.mock('@/components/workflow-editor/hooks/use-wand', () => ({
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

import { LongInput } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/components/long-input'
import { WorkflowScopeProvider } from '@/components/workspace-providers/workflow-scope-provider'
import type { SubBlockConfig } from '@/blocks/types'

const config: SubBlockConfig = { id: 'privateKey', type: 'long-input', password: true }

/** A live workflow-search hit on the base64 body of the secret. */
const SECRET_MATCH = 'fixture-body-abc'
const MATCH_START = SECRET.indexOf(SECRET_MATCH)

function render(password: boolean) {
  return renderToStaticMarkup(
    <WorkflowScopeProvider workspaceId='workspace-1' workflowId='workflow-1'>
      <LongInput blockId='block-1' subBlockId='privateKey' config={config} password={password} />
    </WorkflowScopeProvider>
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
})
