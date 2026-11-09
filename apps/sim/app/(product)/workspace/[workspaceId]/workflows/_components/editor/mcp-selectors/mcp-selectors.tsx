'use client'

import { useMemo } from 'react'
import { Icon } from '@sim/emcn/icon'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { isWorkflowSearchTargetForField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/mcp-selectors/mcp-selectors.module.css'
import {
  type SubBlockConfig,
  useMcpBlockConfig,
  useSubBlockValue,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import {
  createMcpToolOutputSnapshot,
  getMcpTargetOptions,
  MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK,
  useMcpToolServers,
  useMcpTools,
} from '@/platform/lib/data/workflow-editor/selectors'

interface McpServerSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

/** Picks an enabled MCP server or managed account connection, marked with its connector. */
export function McpServerSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: McpServerSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
  const { data: servers = [], error } = useMcpToolServers(workspaceId)
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedId = typeof effectiveValue === 'string' ? effectiveValue : ''
  const options = useMemo(
    () =>
      getMcpTargetOptions(servers).map((option) => ({
        value: option.value,
        label: option.label,
        leading: option.managedConnectorId ? (
          <Icon providerId={option.managedConnectorId} />
        ) : (
          <Icon name='I126' />
        ),
      })),
    [servers]
  )
  const selected = options.find((option) => option.value === selectedId)
  const searchMatch = isWorkflowSearchTargetForField({
    activeSearchTarget,
    subBlockId: subBlock.id,
  })
  const label = subBlock.title || subBlock.placeholder || 'MCP server'

  return (
    <div className={styles.picker} data-search-match={searchMatch || undefined}>
      <SearchableSelect
        label={label}
        labelHidden
        options={options}
        value={selectedId || null}
        selectedLabel={selectedId ? (selected?.label ?? selectedId) : undefined}
        selectedLeading={selected?.leading}
        onValueChange={(next) => {
          if (!isPreview && next !== null) setStoreValue(next)
        }}
        placeholder={subBlock.placeholder || 'Select MCP server'}
        searchLabel='Search MCP servers'
        error={error instanceof Error ? error.message : undefined}
        disabled={disabled || isPreview}
      />
    </div>
  )
}

interface McpToolSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
  /** Sibling values in preview or inside a tool, in place of the block's stored values. */
  previewContextValues?: Record<string, unknown>
}

/**
 * Picks a tool of the selected MCP server, caching its input schema and output snapshot on the
 * block so its arguments and outputs render before the server answers again.
 */
export function McpToolSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: McpToolSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
  const { mcpTools, error, refreshTools } = useMcpTools(workspaceId)
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)
  const [, setSchemaCache] = useSubBlockValue<unknown>(blockId, '_toolSchema')
  const [, setOutputSchemaSnapshot] = useSubBlockValue<unknown>(
    blockId,
    MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK
  )
  const { server: serverValue } = useMcpBlockConfig({ blockId, previewContextValues })

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedToolId = typeof effectiveValue === 'string' ? effectiveValue : ''
  const availableTools = useMemo(
    () => mcpTools.filter((tool) => tool.serverId === serverValue),
    [mcpTools, serverValue]
  )
  const selectedTool = availableTools.find(
    (tool) => tool.id === selectedToolId || tool.name === selectedToolId
  )
  const options = useMemo(
    () => availableTools.map((tool) => ({ value: tool.name, label: tool.name })),
    [availableTools]
  )

  const handleChange = (value: string | null) => {
    if (isPreview || value === null) return
    const matchedTool = availableTools.find((tool) => tool.name === value)
    setStoreValue(matchedTool?.name ?? value)
    setSchemaCache(matchedTool?.inputSchema ?? null)
    setOutputSchemaSnapshot(
      matchedTool && typeof serverValue === 'string'
        ? createMcpToolOutputSnapshot(serverValue, matchedTool.name, matchedTool.outputSchema)
        : null
    )
  }

  const searchMatch = isWorkflowSearchTargetForField({
    activeSearchTarget,
    subBlockId: subBlock.id,
  })
  const label = subBlock.title || subBlock.placeholder || 'Tool'

  return (
    <div className={styles.picker} data-search-match={searchMatch || undefined}>
      <SearchableSelect
        label={label}
        labelHidden
        options={options}
        value={selectedTool?.name ?? (selectedToolId || null)}
        selectedLabel={selectedToolId ? (selectedTool?.name ?? selectedToolId) : undefined}
        onValueChange={handleChange}
        onOpenChange={(open) => {
          if (open && serverValue) void refreshTools()
        }}
        placeholder={serverValue ? subBlock.placeholder || 'Select tool' : 'Select server first'}
        searchLabel='Search tools'
        error={error ?? undefined}
        disabled={disabled || isPreview || !serverValue}
      />
    </div>
  )
}
