'use client'

import { useMemo } from 'react'
import { ArrowRight, cn } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { INTERACTION_CARD_ROW_CLASSES } from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import type { QuestionResourceType } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/**
 * The current workspace's live resources of one family. Only the requested
 * family's list is fetched; the others stay disabled. Outside a workspace (an
 * organization chat) there is nothing to list and the card falls back to its
 * free-text row.
 */
function useResourceCandidates(type: QuestionResourceType): {
  candidates: AvailableItem[]
  isPending: boolean
} {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const has = Boolean(workspaceId)
  const workflows = useWorkflows(workspaceId, { enabled: has && type === 'workflow' })
  const tables = useTablesList(workspaceId, 'active', { enabled: has && type === 'table' })
  const files = useWorkspaceFiles(workspaceId ?? '', 'active', { enabled: has && type === 'file' })
  const knowledgeBases = useKnowledgeBasesQuery(workspaceId, {
    enabled: has && type === 'knowledgebase',
  })
  const query = { workflow: workflows, table: tables, file: files, knowledgebase: knowledgeBases }[
    type
  ]
  const candidates = useMemo(
    () => (query.data ?? []).map((item) => ({ id: item.id, name: item.name })),
    [query.data]
  )
  return { candidates, isPending: has && query.isPending }
}

/** Rows mounted at once; the scroll box shows about five, and typing searches the rest. */
const PREVIEW_LIMIT = 50

interface ResourceQuestionRowsProps {
  resourceType: QuestionResourceType
  /** The card's free-text entry, which doubles as the list's search filter. */
  query: string
  disabled: boolean
  onPick: (resource: MothershipResource) => void
}

/**
 * Option rows for a `resource_select` question: the workspace's resources of
 * the requested family, rendered with the same row the add-resource menu uses
 * and filtered by what the user types into the card's free-text row.
 */
export function ResourceQuestionRows({
  resourceType,
  query,
  disabled,
  onPick,
}: ResourceQuestionRowsProps) {
  const { candidates, isPending } = useResourceCandidates(resourceType)
  const config = getResourceConfig(resourceType)
  const needle = query.trim().toLowerCase()
  const matches = useMemo(
    () =>
      needle
        ? candidates.filter((candidate) => candidate.name.toLowerCase().includes(needle))
        : candidates,
    [candidates, needle]
  )
  const visible = matches.slice(0, PREVIEW_LIMIT)
  const label = config.label.toLowerCase()

  if (visible.length === 0) {
    return (
      <p className={cn(INTERACTION_CARD_ROW_CLASSES, 'text-[var(--text-muted)] text-sm')}>
        {emptyMessage(label, isPending, needle.length > 0)}
      </p>
    )
  }

  return (
    <div className='max-h-[180px] overflow-y-auto'>
      {visible.map((candidate, i) => (
        <button
          key={candidate.id}
          type='button'
          disabled={disabled}
          onClick={() => onPick(resourceFromItem(resourceType, candidate))}
          className={cn(
            INTERACTION_CARD_ROW_CLASSES,
            'w-full',
            disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
            i > 0 && 'border-t'
          )}
        >
          <span className='flex min-w-0 flex-1 items-center gap-2 text-[var(--text-body)] text-sm'>
            {config.renderDropdownItem({ item: candidate })}
          </span>
          <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        </button>
      ))}
      {matches.length > visible.length && (
        <p
          className={cn(INTERACTION_CARD_ROW_CLASSES, 'border-t text-[var(--text-muted)] text-sm')}
        >
          {`${matches.length - visible.length} more ${label} — type to search`}
        </p>
      )}
    </div>
  )
}

function emptyMessage(label: string, isPending: boolean, searching: boolean): string {
  if (isPending) return `Loading ${label}…`
  if (searching) return `No matching ${label}`
  return `No ${label} yet`
}
