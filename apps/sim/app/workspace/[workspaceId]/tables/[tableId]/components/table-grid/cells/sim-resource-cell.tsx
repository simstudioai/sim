'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** Sim resource kinds a table cell URL can point to within the current workspace. */
export type SimResourceType = 'workflow' | 'table' | 'knowledge' | 'file'

const FALLBACK_LABEL: Record<SimResourceType, string> = {
  workflow: 'Workflow',
  table: 'Table',
  knowledge: 'Knowledge base',
  file: 'File',
}

interface SimResourceCellProps {
  /** Always the current workspace — the resolver only emits this kind for same-workspace URLs. */
  workspaceId: string
  resourceType: SimResourceType
  resourceId: string
  /** In-app pathname the resource link navigates to. */
  href: string
  isEditing: boolean
}

/**
 * Renders a cell whose value is a URL pointing to a sim resource in the current
 * workspace as a tagged-resource chip — the same icon (and per-workflow colored
 * square) used for @-style resource mentions, plus the resource's name as a link.
 * Only the list matching `resourceType` is fetched; the other queries stay
 * disabled so a sim-resource cell subscribes to a single shared list.
 */
export function SimResourceCell({
  workspaceId,
  resourceType,
  resourceId,
  href,
  isEditing,
}: SimResourceCellProps) {
  const { data: workflows = [] } = useWorkflows(
    resourceType === 'workflow' ? workspaceId : undefined
  )
  const { data: tables = [] } = useTablesList(resourceType === 'table' ? workspaceId : undefined)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId, {
    enabled: resourceType === 'knowledge',
  })
  const { data: files = [] } = useWorkspaceFiles(workspaceId, 'active', {
    enabled: resourceType === 'file',
  })

  const workflow =
    resourceType === 'workflow' ? workflows.find((w) => w.id === resourceId) : undefined

  const name = useMemo(() => {
    switch (resourceType) {
      case 'workflow':
        return workflow?.name
      case 'table':
        return tables.find((t) => t.id === resourceId)?.name
      case 'knowledge':
        return knowledgeBases.find((kb) => kb.id === resourceId)?.name
      case 'file':
        return files.find((f) => f.id === resourceId)?.name
    }
  }, [resourceType, resourceId, workflow, tables, knowledgeBases, files])

  const label = name ?? FALLBACK_LABEL[resourceType]

  const context: ChatMessageContext =
    resourceType === 'workflow'
      ? { kind: 'workflow', label, workflowId: resourceId }
      : resourceType === 'table'
        ? { kind: 'table', label, tableId: resourceId }
        : resourceType === 'knowledge'
          ? { kind: 'knowledge', label, knowledgeId: resourceId }
          : { kind: 'file', label, fileId: resourceId }

  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', isEditing && 'invisible')}>
      <ContextMentionIcon
        context={context}
        workflowColor={workflow?.color ?? null}
        className='size-[14px] shrink-0 text-[var(--text-icon)]'
      />
      <a
        href={href}
        className={cn(
          'min-w-0 overflow-clip text-ellipsis text-[var(--text-primary)] underline underline-offset-2 hover:opacity-70',
          isEditing && 'pointer-events-none'
        )}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
    </span>
  )
}
