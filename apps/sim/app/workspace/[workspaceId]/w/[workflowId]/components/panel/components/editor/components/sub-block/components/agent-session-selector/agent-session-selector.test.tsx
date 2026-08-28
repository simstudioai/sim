/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionCatalogEntry } from '@/lib/workflows/agent-sessions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface CapturedOption {
  label: string
  value: string
  onSelect?: () => void
}

interface CapturedComboboxProps {
  value?: string
  groups?: Array<{ section?: string; items: CapturedOption[] }>
  onChange?: (value: string) => void
  overlayContent?: React.ReactNode
}

const mocks = vi.hoisted(() => ({
  comboboxProps: { current: null as CapturedComboboxProps | null },
  batchSet: vi.fn(),
  currentValues: {
    agentId: '',
    mode: 'cloud_plan',
    model: 'gpt-5.2-codex',
    owner: 'old-owner',
    repo: 'old-repo',
    baseBranch: null,
  } as Record<string, unknown>,
  sessions: [] as AgentSessionCatalogEntry[],
}))

vi.mock('@sim/emcn', () => ({
  Chip: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  ChipCombobox: (props: CapturedComboboxProps) => {
    mocks.comboboxProps.current = props
    return <div data-testid='agent-session-selector'>{props.overlayContent}</div>
  },
}))

vi.mock('@sim/emcn/icons', () => ({ Plus: () => null, Settings: () => null }))
vi.mock('@sim/utils/id', () => ({ generateId: () => 'fresh-agent-id' }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', workflowId: 'workflow-1' }),
}))
vi.mock('@/components/codex/codex-agent-config-modal', () => ({
  CodexAgentConfigModal: () => null,
}))
vi.mock('@/hooks/use-agent-session-catalog', () => ({
  useAgentSessionCatalog: () => ({
    sessions: mocks.sessions,
    currentSession: mocks.sessions[0] ?? null,
  }),
}))
vi.mock('@/hooks/use-collaborative-workflow', () => ({
  useCollaborativeWorkflow: () => ({
    collaborativeBatchSetSubblockValues: mocks.batchSet,
  }),
}))
vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: {
    getState: () => ({
      getValue: (_blockId: string, subBlockId: string) => mocks.currentValues[subBlockId],
    }),
  },
}))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: { blocks: Record<string, { type: string }> }) => unknown) =>
    selector({ blocks: { codex: { type: 'codex' } } }),
}))

import { AgentSessionSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/agent-session-selector/agent-session-selector'

const CONFIG = {
  id: 'agentId',
  title: 'Agent',
  type: 'agent-session-selector' as const,
  agentSessionFields: ['mode', 'model', 'owner', 'repo', 'baseBranch'],
}

let container: HTMLDivElement
let root: Root

describe('AgentSessionSelector', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.sessions = [
      {
        id: 'current-internal-id',
        label: 'Agent 1',
        color: '#6366f1',
        blockIds: ['codex'],
        blockNames: ['Codex'],
        sourceBlockId: 'codex',
        values: {},
      },
      {
        id: 'target-internal-id',
        label: 'Agent 2',
        color: '#0284c7',
        blockIds: ['other'],
        blockNames: ['Other Codex'],
        sourceBlockId: 'other',
        values: {
          mode: 'cloud',
          model: 'gpt-5.3-codex',
          owner: 'new-owner',
          repo: 'new-repo',
          baseBranch: 'main',
        },
      },
    ]
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mocks.comboboxProps.current = null
    mocks.batchSet.mockReset()
  })

  it('shows friendly labels and atomically inherits an existing agent configuration', async () => {
    await act(async () => {
      root.render(<AgentSessionSelector blockId='codex' subBlock={CONFIG} />)
    })

    expect(
      mocks.comboboxProps.current?.groups?.flatMap((group) => group.items.map(({ label }) => label))
    ).toEqual(['New agent', 'Agent 1', 'Agent 2'])

    act(() => mocks.comboboxProps.current?.onChange?.('target-internal-id'))

    expect(mocks.batchSet).toHaveBeenCalledOnce()
    expect(mocks.batchSet).toHaveBeenCalledWith([
      { blockId: 'codex', subblockId: 'agentId', value: 'target-internal-id', expectedValue: '' },
      { blockId: 'codex', subblockId: 'mode', value: 'cloud', expectedValue: 'cloud_plan' },
      {
        blockId: 'codex',
        subblockId: 'model',
        value: 'gpt-5.3-codex',
        expectedValue: 'gpt-5.2-codex',
      },
      { blockId: 'codex', subblockId: 'owner', value: 'new-owner', expectedValue: 'old-owner' },
      { blockId: 'codex', subblockId: 'repo', value: 'new-repo', expectedValue: 'old-repo' },
      { blockId: 'codex', subblockId: 'baseBranch', value: 'main', expectedValue: null },
    ])
  })

  it('creates a new hidden identity without clearing the current configuration', async () => {
    await act(async () => {
      root.render(<AgentSessionSelector blockId='codex' subBlock={CONFIG} />)
    })

    const newAgent = mocks.comboboxProps.current?.groups?.[0].items[0]
    act(() => newAgent?.onSelect?.())

    expect(mocks.batchSet).toHaveBeenCalledWith([
      { blockId: 'codex', subblockId: 'agentId', value: 'fresh-agent-id', expectedValue: '' },
    ])
  })
})
