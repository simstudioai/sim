/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'

const { fetched, editor } = vi.hoisted(() => ({
  editor: {
    blocks: {} as Record<string, unknown>,
    values: {} as Record<string, unknown>,
    subBlocks: [] as SubBlockConfig[],
    credentials: {} as Record<string, { type: 'oauth' | 'service_account' }>,
  },
  fetched: {
    options: [
      { id: 'col_a', label: 'Email' },
      { id: 'col_b', label: 'Name' },
    ] as { id: string; label: string }[],
    isDynamic: true,
    isLoadingOptions: false,
    hasLoadedOptions: true,
    fetchError: null as string | null,
    hydratedOptions: [] as { id: string; label: string }[],
    selectedValues: ['col_a', 'col_gone'] as string[],
  },
}))

vi.mock('@sim/emcn', () => ({
  ChipTag: ({ children }: { children?: React.ReactNode }) => <span data-chip>{children}</span>,
  Combobox: ({
    options,
    multiSelectValues,
    overlayContent,
  }: {
    options: { value: string; label: string; hidden?: boolean }[]
    multiSelectValues?: string[]
    overlayContent?: React.ReactNode
  }) => (
    <div>
      <div data-overlay>{overlayContent}</div>
      <ul>
        {options
          .filter((option) => !option.hidden)
          .map((option) => (
            <li key={option.value} data-value={option.value}>
              {option.label}
              {multiSelectValues?.includes(option.value) ? ' [selected]' : ''}
            </li>
          ))}
      </ul>
    </div>
  ),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-fetched-options',
  () => ({
    useFetchedOptions: () => ({
      fetchedOptions: fetched.options,
      isDynamic: fetched.isDynamic,
      isLoadingOptions: fetched.isLoadingOptions,
      hasLoadedOptions: fetched.hasLoadedOptions,
      fetchError: fetched.fetchError,
      hydratedOption: null,
      hydratedOptions: fetched.hydratedOptions,
      missingOptionId: null,
      refetch: () => {},
    }),
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => [fetched.selectedValues, () => {}] })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({ useActiveSearchTarget: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text',
  () => ({ formatDisplayText: (text: string) => text })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight',
  () => ({ getWorkflowSearchLabelHighlight: () => undefined })
)
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useWorkspaceOrganizationAccounts: () => ({ data: { allowed: false } }),
}))
vi.mock('@/hooks/use-operation-access', () => ({
  useOperationAccess: () => ({
    getDeniedOperations: () => new Set<string>(),
    resolveDefaultOperation: () => undefined,
    isPermissionLoading: false,
  }),
}))
vi.mock('@/executor/handlers/response/response-handler', () => ({ ResponseBlockHandler: {} }))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) => selector({ blocks: editor.blocks }),
}))
vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (selector: (state: unknown) => unknown) =>
    selector({ activeWorkflowId: 'wf-1', hydration: { workspaceId: 'workspace-1' } }),
}))
vi.mock('@/stores/workflows/subblock/store', () => ({
  EMPTY_BLOCK_SUBBLOCK_VALUES: {},
  useSubBlockStore: (selector: (state: unknown) => unknown) =>
    selector({ workflowValues: { 'wf-1': { 'block-1': editor.values } } }),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: () => ({ subBlocks: editor.subBlocks }),
}))
vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredential: (id?: string) => ({ data: id ? editor.credentials[id] : undefined }),
}))

import { Dropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/dropdown'
import { slackOAuthTrigger } from '@/triggers/slack/oauth'
import { SLACK_ALL_EVENT_OPTIONS } from '@/triggers/slack/shared'

function render(): string {
  return renderToStaticMarkup(
    <Dropdown
      blockId='block-1'
      subBlockId='outputColumns'
      multiSelect
      selectorKey='table.outputColumns'
      preserveLabelCase
      placeholder='All columns'
    />
  )
}

describe('Dropdown multi-select stale selections', () => {
  it('renders a removable row for a selected value the loaded list lacks, shown by its id', () => {
    const html = render()

    expect(html).toContain('data-value="col_gone"')
    expect(html).toContain('col_gone [selected]')
    expect(html).toContain('<span class="truncate">col_gone</span>')
    expect(html).toContain('Email [selected]')
  })

  it('adds no row for a selection before the list has loaded', () => {
    fetched.isLoadingOptions = true
    fetched.hasLoadedOptions = false
    try {
      const html = render()
      expect(html).toContain('<span class="truncate">col_gone</span>')
      expect(html).not.toContain('data-value="col_gone"')
    } finally {
      fetched.isLoadingOptions = false
      fetched.hasLoadedOptions = true
    }
  })

  it('still offers removable rows when the loaded list is empty (every column deleted)', () => {
    const previous = fetched.options
    fetched.options = []
    try {
      const html = render()
      expect(html).toContain('data-value="col_a"')
      expect(html).toContain('data-value="col_gone"')
    } finally {
      fetched.options = previous
    }
  })

  it('uses hydrated labels for selected values missing from the loaded list', () => {
    fetched.hydratedOptions = [{ id: 'col_gone', label: 'Former column' }]
    try {
      const html = render()
      expect(html).toContain('Former column [selected]')
      expect(html).toContain('<span class="truncate">Former column</span>')
    } finally {
      fetched.hydratedOptions = []
    }
  })

  it('preserves selected value order when hydrating multiple missing options', () => {
    const previousOptions = fetched.options
    const previousSelectedValues = fetched.selectedValues
    fetched.options = []
    fetched.selectedValues = ['col_first', 'col_second']
    fetched.hydratedOptions = [
      { id: 'col_first', label: 'First column' },
      { id: 'col_second', label: 'Second column' },
    ]
    try {
      const html = render()
      expect(html.indexOf('data-value="col_first"')).toBeLessThan(
        html.indexOf('data-value="col_second"')
      )
    } finally {
      fetched.options = previousOptions
      fetched.selectedValues = previousSelectedValues
      fetched.hydratedOptions = []
    }
  })
})

describe('Slack event credential options', () => {
  beforeEach(() => {
    fetched.isDynamic = false
    editor.subBlocks = slackOAuthTrigger.subBlocks
    editor.credentials = {
      native: { type: 'oauth' },
      custom: { type: 'service_account' },
    }
    editor.values = {}
    editor.blocks = {
      'block-1': { type: 'slack_v2', triggerMode: true, data: { canonicalModes: {} } },
    }
  })

  function renderEvents() {
    return renderToStaticMarkup(
      <Dropdown
        blockId='block-1'
        subBlockId='eventType'
        options={[...SLACK_ALL_EVENT_OPTIONS]}
        value='message'
      />
    )
  }

  it.each([
    ['native', true],
    ['custom', false],
    ['unresolved', false],
    ['', false],
  ])('shows native Assistant options only for a resolved OAuth credential (%s)', (id, visible) => {
    editor.values = { customBotCredential: id }
    const html = renderEvents()
    for (const event of ['assistant_thread_started', 'assistant_thread_context_changed']) {
      expect(html.includes(`data-value="${event}"`)).toBe(visible)
    }
    expect(html).toContain('data-value="message"')
    expect(html).toContain('data-value="agent_session_stopped"')
  })

  it.each([
    ['basic', 'native', 'custom', true],
    ['basic', 'custom', 'native', false],
    ['advanced', 'custom', 'native', true],
    ['advanced', 'native', 'custom', false],
  ])(
    'uses the active %s credential rather than its stale counterpart',
    (mode, basic, advanced, visible) => {
      editor.blocks = {
        'block-1': {
          type: 'slack_v2',
          triggerMode: true,
          data: { canonicalModes: { botCredential: mode } },
        },
      }
      editor.values = { customBotCredential: basic, manualBotCredential: advanced }
      expect(renderEvents().includes('data-value="assistant_thread_started"')).toBe(visible)
    }
  )
})
