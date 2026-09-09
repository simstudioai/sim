/** @vitest-environment jsdom */
import { act, type ComponentProps, type ReactNode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { StoredTool } from '@/lib/workflows/tool-input/types'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

const fixture = vi.hoisted(() => ({
  tools: [] as StoredTool[],
  target: null as { subBlockId: string; valuePath: (string | number)[] } | null,
  write: vi.fn(),
  canonical: vi.fn(),
  blocks: [] as BlockConfig[],
  replace: (_tools: StoredTool[]) => {},
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', workflowId: 'workflow-1' }),
}))
vi.mock('@/blocks', () => ({
  getAllBlocks: () => fixture.blocks,
  getBlock: (type: string) => fixture.blocks.find((block) => block.type === type),
}))
vi.mock('@/blocks/custom/client-overlay', () => ({ useCustomBlockOverlayVersion: () => 0 }))
vi.mock('@/blocks/utils', () => ({ BUILT_IN_TOOL_TYPES: new Set() }))
vi.mock('@/tools/metadata', () => ({ getToolMetadata: () => undefined }))
vi.mock('@/providers/models', () => ({ supportsForcedToolUse: () => false }))
vi.mock('@/providers/utils', () => ({
  getProviderFromModel: () => '',
  supportsToolUsageControl: () => false,
}))
vi.mock('@/hooks/use-collaborative-workflow', () => ({
  useCollaborativeWorkflow: () => ({
    collaborativeSetBlockCanonicalMode: fixture.canonical,
    collaborativeSetBlockCanonicalModes: fixture.canonical,
  }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    filterBlocks: (blocks: BlockConfig[]) => blocks,
    config: {},
    isLoading: false,
  }),
}))
vi.mock('@/hooks/use-operation-access', () => ({
  useOperationAccess: () => ({ getDeniedOperations: () => new Set() }),
}))
vi.mock('@/hooks/queries/custom-tools', () => ({ useCustomTools: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/credentials', () => ({ useWorkspaceCredential: () => ({}) }))
vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/deployments', () => ({
  useDeploymentInfo: () => ({ data: { isDeployed: true } }),
  useDeployWorkflow: () => ({}),
}))
vi.mock('@/hooks/mcp/use-mcp-tools', () => ({
  useMcpTools: () => ({ mcpTools: [], isLoading: false }),
}))
vi.mock('@/hooks/queries/mcp', () => ({
  useMcpToolServers: () => ({ data: [] }),
  useStoredMcpTools: () => ({ data: [] }),
  useAllowedMcpDomains: () => ({}),
  useCreateMcpServer: () => ({}),
  useForceRefreshMcpTools: () => ({ mutate: () => {} }),
}))
vi.mock('@/hooks/mcp/use-mcp-oauth-popup', () => ({ useMcpOauthPopup: () => ({}) }))
vi.mock('@/hooks/use-available-env-vars', () => ({ useAvailableEnvVarKeys: () => [] }))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: () => {} }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canAdmin: false }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/mcp/components/mcp-server-form-modal/mcp-server-form-modal',
  () => ({ McpServerFormModal: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal',
  () => ({ CustomToolModal: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text',
  () => ({ formatDisplayText: (text: string) => text })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight',
  () => ({ getActiveWorkflowSearchHighlight: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({
    useActiveSearchTarget: () => fixture.target,
    ActiveSearchTargetProvider: ({ children }: { children: ReactNode }) => children,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: () => {
      const [value, setValue] = useState(fixture.tools)
      fixture.replace = setValue
      return [
        value,
        (tools: StoredTool[]) => {
          fixture.write(tools)
          fixture.tools = structuredClone(tools)
          setValue(fixture.tools)
        },
      ]
    },
  })
)
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({ blocks: { 'block-1': { type: 'agent' } } }),
}))
vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: Object.assign(() => 'workflow-1', {
    getState: () => ({ activeWorkflowId: 'workflow-1' }),
  }),
}))
vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: create<{
    workflowValues: Record<string, Record<string, Record<string, unknown>>>
    getValue: (block: string, field: string) => unknown
    setValue: (block: string, field: string, value: unknown) => void
  }>((set, get) => ({
    workflowValues: {},
    getValue: (block, field) => get().workflowValues['workflow-1']?.[block]?.[field],
    setValue: (block, field, value) =>
      set((state) => ({
        workflowValues: {
          'workflow-1': {
            ...state.workflowValues['workflow-1'],
            [block]: { ...state.workflowValues['workflow-1']?.[block], [field]: value },
          },
        },
      })),
  })),
}))

/** Keep the real tool-param bridge; substitute only the heavy leaf field renderer. */
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block',
  () => ({
    SubBlock: ({
      blockId,
      config,
      disabled,
    }: {
      blockId: string
      config: SubBlockConfig
      disabled: boolean
    }) => {
      const value = useSubBlockStore((state) => state.getValue(blockId, config.id))
      return (
        <input
          aria-label={config.title}
          disabled={disabled}
          value={String(value ?? '')}
          onChange={(event) =>
            useSubBlockStore.getState().setValue(blockId, config.id, event.target.value)
          }
        />
      )
    },
  })
)

vi.mock('@sim/emcn', () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<'button'> & { variant?: string }) => (
    <button {...props} />
  ),
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Combobox: ({
    groups,
    disabled,
    onOpenChange,
  }: {
    groups?: { items: { label: string; onSelect?: () => void; disabled?: boolean }[] }[]
    disabled?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <div>
      <button onClick={() => onOpenChange?.(true)}>Open tools</button>
      {groups
        ?.flatMap((group) => group.items)
        .map((item) => (
          <button key={item.label} disabled={disabled || item.disabled} onClick={item.onSelect}>
            Add {item.label}
          </button>
        ))}
    </div>
  ),
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => children,
    Trigger: ({ children }: { children: ReactNode }) => children,
    Content: () => null,
  },
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: () => null,
  PopoverItem: () => null,
}))

import { ToolInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/tool-input'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

let container: HTMLDivElement
let root: Root
const tool = (value: string): StoredTool => ({
  type: 'mcp',
  toolId: `mcp-${value}`,
  title: value,
  isExpanded: true,
  params: { query: value, serverId: 'server-1', toolName: value },
  schema: { type: 'object', properties: { query: { type: 'string' } } },
})
const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
const render = (props: Partial<ComponentProps<typeof ToolInput>> = {}) =>
  act(() => root.render(<ToolInput blockId='block-1' subBlockId='tools' {...props} />))
const click = (element: HTMLElement) => act(() => element.click())

beforeEach(() => {
  vi.clearAllMocks()
  fixture.tools = [tool('First'), tool('Second')]
  fixture.target = null
  fixture.blocks = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ToolInput local expansion', () => {
  it('ignores persisted expansion and independently toggles without writing workflow data', () => {
    render()
    expect(buttons().map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'false',
    ])
    click(buttons()[0])
    click(buttons()[1])
    click(buttons()[0])
    expect(buttons().map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
    ])
    expect(fixture.write).not.toHaveBeenCalled()
    expect(fixture.canonical).not.toHaveBeenCalled()
  })

  it('preserves an immediate parameter edit through collapse and real bridge rehydration', () => {
    render()
    click(buttons()[0])
    const input = container.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Edited'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(fixture.tools[0].params?.query).toBe('Edited')
    click(buttons()[0])
    click(buttons()[0])
    expect(container.querySelector('input')?.value).toBe('Edited')
    expect(fixture.write).toHaveBeenCalledTimes(1)
  })

  it('retains the correct duplicate instance when an earlier row is removed', () => {
    fixture.tools[1].toolId = fixture.tools[0].toolId
    render()
    click(buttons()[1])
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Remove tool"]')!)
    expect(buttons()[0].getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('input')?.value).toBe('Second')
  })

  it('follows the dragged instance when rows reorder', () => {
    render()
    click(buttons()[0])
    const rows = container.querySelectorAll<HTMLElement>('[draggable="true"]')
    const transfer = { setData: () => {}, effectAllowed: '', dropEffect: '' }
    act(() => {
      const event = new Event('dragstart', { bubbles: true })
      Object.assign(event, { dataTransfer: transfer })
      rows[1].dispatchEvent(event)
    })
    act(() => {
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.assign(event, { dataTransfer: transfer })
      rows[0].dispatchEvent(event)
    })
    expect(buttons().map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
    ])
    expect(container.querySelector('input')?.value).toBe('First')
  })

  it('resets after an external replacement or a different editor scope', () => {
    render()
    click(buttons()[0])
    act(() => fixture.replace([tool('Replacement')]))
    expect(buttons()[0].getAttribute('aria-expanded')).toBe('false')
    click(buttons()[0])
    render({ blockId: 'block-2' })
    expect(buttons()[0].getAttribute('aria-expanded')).toBe('false')
  })

  it('opens search matches without changing the local choice or stored tools', () => {
    fixture.target = { subBlockId: 'tools', valuePath: [1, 'params', 'query'] }
    render()
    expect(buttons().map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
    ])
    fixture.target = null
    render({ disabled: true })
    expect(buttons()[1].getAttribute('aria-expanded')).toBe('false')
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it('permits locked inspection and opt-in preview expansion without editable fields', () => {
    render({ disabled: true })
    click(buttons()[0])
    expect(container.querySelector('input')?.disabled).toBe(true)
    render({ isPreview: true, previewValue: fixture.tools })
    expect(buttons()[0].disabled).toBe(true)
    render({ isPreview: true, previewValue: fixture.tools, allowExpandInPreview: true })
    click(buttons()[0])
    expect(container.querySelector('input')?.disabled).toBe(true)
    expect(fixture.write).not.toHaveBeenCalled()
  })

  it('opens only the newly added configurable tool without persisting expansion flags', () => {
    render()
    click(buttons()[0])
    click(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Open tools'
      )!
    )
    click(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Add MCP Server (Advanced)'
      )!
    )
    expect(buttons().map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'true',
      'false',
      'true',
    ])
    expect(fixture.tools[2]).not.toHaveProperty('isExpanded')
    expect(fixture.tools[0].isExpanded).toBe(true)
  })
})
