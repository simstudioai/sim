/**
 * @vitest-environment node
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * Every input the sub-block renderer can pick renders the same probe, so an
 * assertion can read back whether the renderer forwarded `config.password` for
 * a given sub-block type. A type that drops the flag renders `password="off"`.
 */
const { stubInput } = vi.hoisted(() => {
  const stubInput =
    (name: string) =>
    ({ password }: { password?: boolean }) => (
      <div data-input={name} data-password={password ? 'on' : 'off'} />
    )
  return { stubInput }
})

vi.mock('@sim/emcn', () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type='button'>{children}</button>,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Input: () => null,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@sim/emcn/icons', () => ({
  ArrowLeftRight: () => null,
  ArrowUp: () => null,
  Check: () => null,
  Clipboard: () => null,
  SquareArrowUpRight: () => null,
  TriangleAlert: () => null,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components',
  () => ({
    CheckboxList: stubInput('checkbox-list'),
    Code: stubInput('code'),
    ComboBox: stubInput('combobox'),
    ConditionInput: stubInput('condition-input'),
    CredentialSelector: stubInput('credential-selector'),
    DocumentTagEntry: stubInput('document-tag-entry'),
    Dropdown: stubInput('dropdown'),
    EvalInput: stubInput('eval-input'),
    FileUpload: stubInput('file-upload'),
    FilterBuilder: stubInput('filter-builder'),
    GroupedCheckboxList: stubInput('grouped-checkbox-list'),
    InputFormat: stubInput('input-format'),
    InputMapping: stubInput('input-mapping'),
    KnowledgeBaseSelector: stubInput('knowledge-base-selector'),
    KnowledgeTagFilters: stubInput('knowledge-tag-filters'),
    LongInput: stubInput('long-input'),
    McpDynamicArgs: stubInput('mcp-dynamic-args'),
    McpServerSelector: stubInput('mcp-server-selector'),
    McpToolSelector: stubInput('mcp-tool-selector'),
    MessagesInput: stubInput('messages-input'),
    ResponseFormat: stubInput('response-format'),
    ScheduleInfo: stubInput('schedule-info'),
    SelectorInput: stubInput('selector-input'),
    ShortInput: stubInput('short-input'),
    SimFolderTreeSelector: stubInput('sim-folder-tree-selector'),
    SkillInput: stubInput('skill-input'),
    SliderInput: stubInput('slider-input'),
    SortBuilder: stubInput('sort-builder'),
    Switch: stubInput('switch'),
    Table: stubInput('table'),
    TableSelector: stubInput('table-selector'),
    Text: stubInput('text'),
    TimeInput: stubInput('time-input'),
    ToolInput: stubInput('tool-input'),
    VariablesInput: stubInput('variables-input'),
    WorkflowSelectorInput: stubInput('workflow-selector'),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/modal-registry',
  () => ({ MODAL_REGISTRY: {} })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate',
  () => ({ useDependsOnGate: () => ({ finalDisabled: false }) })
)

vi.mock('@/hooks/use-webhook-management', () => ({
  useWebhookManagement: () => ({ webhookUrl: null }),
}))

import { PASSWORD_MASKED_SUBBLOCK_TYPES } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/password-mask'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import type { SubBlockConfig } from '@/blocks/types'

function renderSubBlock(config: SubBlockConfig) {
  return renderToStaticMarkup(<SubBlock blockId='block-1' config={config} />)
}

describe('SubBlock password forwarding', () => {
  it.each(PASSWORD_MASKED_SUBBLOCK_TYPES)('forwards password to the %s renderer', (type) => {
    const html = renderSubBlock({
      id: 'secret',
      title: 'Secret',
      type,
      password: true,
      columns: ['Key', 'Value'],
    })

    expect(html).toContain('data-password="on"')
  })

  it.each(PASSWORD_MASKED_SUBBLOCK_TYPES)('leaves the %s renderer unmasked by default', (type) => {
    const html = renderSubBlock({
      id: 'secret',
      title: 'Secret',
      type,
      columns: ['Key', 'Value'],
    })

    expect(html).toContain('data-password="off"')
  })
})
