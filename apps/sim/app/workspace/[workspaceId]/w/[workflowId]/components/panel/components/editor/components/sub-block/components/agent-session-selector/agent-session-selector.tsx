'use client'

import { useCallback, useMemo, useState } from 'react'
import { Chip, ChipCombobox } from '@sim/emcn'
import { Plus, Settings } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { isEqual } from 'es-toolkit'
import { useParams } from 'next/navigation'
import { CodexAgentConfigModal } from '@/components/codex/codex-agent-config-modal'
import { getAgentSessionColor, resolveAgentSessionId } from '@/lib/workflows/agent-sessions'
import type { SubBlockConfig } from '@/blocks/types'
import { useAgentSessionCatalog } from '@/hooks/use-agent-session-catalog'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface AgentSessionSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

function AgentColorDot({ color }: { color: string }) {
  return (
    <span
      className='size-2 flex-shrink-0 rounded-full'
      style={{ backgroundColor: color }}
      aria-hidden='true'
    />
  )
}

/** Selects workflow-local logical agents without exposing their internal UUIDs. */
export function AgentSessionSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: AgentSessionSelectorProps) {
  const params = useParams<{ workspaceId?: string; workflowId?: string }>()
  const workspaceId = params?.workspaceId ?? ''
  const workflowId = params?.workflowId ?? ''
  const [configOpen, setConfigOpen] = useState(false)
  const blockType = useWorkflowStore((state) => state.blocks[blockId]?.type ?? '')
  const compatibleSubBlockIds = subBlock.agentSessionFields ?? []
  const { sessions, currentSession } = useAgentSessionCatalog({
    blockId,
    blockType,
    sessionSubBlockId: subBlock.id,
    compatibleSubBlockIds,
    previewValue,
  })
  const { collaborativeBatchSetSubblockValues } = useCollaborativeWorkflow()

  const applyAgent = useCallback(
    (agentId: string, inheritedValues?: Record<string, unknown>) => {
      const subBlockStore = useSubBlockStore.getState()
      const candidateUpdates = [
        { subblockId: subBlock.id, value: agentId },
        ...(inheritedValues
          ? compatibleSubBlockIds.map((subblockId) => ({
              subblockId,
              value: inheritedValues[subblockId] ?? null,
            }))
          : []),
      ]
      const updates = candidateUpdates.flatMap((update) => {
        const expectedValue = subBlockStore.getValue(blockId, update.subblockId) ?? null
        return isEqual(expectedValue, update.value) ? [] : [{ blockId, ...update, expectedValue }]
      })

      if (updates.length > 0) collaborativeBatchSetSubblockValues(updates)
    },
    [blockId, collaborativeBatchSetSubblockValues, compatibleSubBlockIds, subBlock.id]
  )

  const handleChange = useCallback(
    (agentId: string) => {
      const target = sessions.find((session) => session.id === agentId)
      if (!target || target.id === currentSession?.id) return
      applyAgent(target.id, target.values)
    },
    [applyAgent, currentSession?.id, sessions]
  )

  const handleCreateAgent = useCallback(() => {
    applyAgent(generateId())
  }, [applyAgent])

  const fallbackAgentId = resolveAgentSessionId(blockId, previewValue)
  const displaySession = currentSession ?? {
    id: fallbackAgentId,
    label: 'Agent 1',
    color: getAgentSessionColor(fallbackAgentId),
    blockIds: [blockId],
    blockNames: [],
    sourceBlockId: blockId,
    values: {},
  }

  const groups = useMemo(
    () => [
      {
        items: [
          {
            label: 'New agent',
            value: '__new_agent__',
            icon: Plus,
            onSelect: handleCreateAgent,
          },
        ],
      },
      {
        section: 'Agents in this workflow',
        items: sessions.map((session) => ({
          label: session.label,
          value: session.id,
          iconElement: <AgentColorDot color={session.color} />,
          suffixElement: (
            <span className='text-[var(--text-muted)] text-xs'>
              {session.blockIds.length} {session.blockIds.length === 1 ? 'step' : 'steps'}
            </span>
          ),
        })),
      },
    ],
    [handleCreateAgent, sessions]
  )

  return (
    <div className='flex flex-col gap-1.5'>
      <ChipCombobox
        aria-label={subBlock.title ?? 'Agent'}
        options={[]}
        groups={groups}
        value={displaySession.id}
        onChange={handleChange}
        disabled={disabled || isPreview}
        searchable={sessions.length > 5}
        searchPlaceholder='Search agents'
        dropdownWidth='trigger'
        overlayContent={
          <span className='flex min-w-0 items-center gap-1.5'>
            <AgentColorDot color={displaySession.color} />
            <span className='truncate'>{displaySession.label}</span>
          </span>
        }
        className='w-full'
      />
      {!isPreview && displaySession.blockIds.length > 1 && (
        <span className='px-0.5 text-[var(--text-muted)] text-xs'>
          Shared by {displaySession.blockIds.length} workflow steps
        </span>
      )}
      {!isPreview && blockType === 'codex' && (
        <div className='flex items-center justify-between gap-2 px-0.5'>
          <span className='text-[var(--text-muted)] text-xs'>Layered Agent settings</span>
          <Chip
            onClick={() => setConfigOpen(true)}
            disabled={disabled || !workspaceId || !workflowId}
            className='h-6 px-2 text-xs'
          >
            <Settings className='size-3' />
            Configure
          </Chip>
        </div>
      )}
      {blockType === 'codex' && workspaceId && workflowId && (
        <CodexAgentConfigModal
          open={configOpen}
          onOpenChange={setConfigOpen}
          workspaceId={workspaceId}
          workflowId={workflowId}
          agentId={displaySession.id}
          agentLabel={displaySession.label}
          agentBlockIds={displaySession.blockIds}
          embeddedConfig={displaySession.values.agentConfig}
          canEdit={!disabled}
        />
      )}
    </div>
  )
}
