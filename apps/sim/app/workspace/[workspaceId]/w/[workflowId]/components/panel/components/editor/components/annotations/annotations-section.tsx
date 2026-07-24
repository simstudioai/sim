'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipTextarea, cn } from '@sim/emcn'
import { ChevronDown, MessageSquare } from 'lucide-react'
import type { WorkspaceMember } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { AnnotationItem } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/annotations/annotation-item'
import {
  useCreateWorkflowAnnotation,
  useDeleteWorkflowAnnotation,
  useUpdateWorkflowAnnotation,
  useWorkflowAnnotationsQuery,
} from '@/hooks/queries/workflow-annotations'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'

interface AnnotationsSectionProps {
  workspaceId: string
  workflowId: string | undefined
  blockId: string
  canEdit: boolean
  canModerate: boolean
}

/**
 * Team comments for the selected block: list with authorship, a composer, and
 * resolve/unresolve state. Lives inside the editor tab's scrollable body.
 */
export function AnnotationsSection({
  workspaceId,
  workflowId,
  blockId,
  canEdit,
  canModerate,
}: AnnotationsSectionProps) {
  const { data: session } = useSession()
  const [isExpanded, setIsExpanded] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [draft, setDraft] = useState('')

  const { data: annotations } = useWorkflowAnnotationsQuery(workflowId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const createAnnotation = useCreateWorkflowAnnotation(workflowId)
  const updateAnnotation = useUpdateWorkflowAnnotation(workflowId)
  const deleteAnnotation = useDeleteWorkflowAnnotation(workflowId)

  const membersById = useMemo(() => {
    const byId = new Map<string, WorkspaceMember>()
    for (const member of members ?? []) {
      byId.set(member.id, member)
    }
    return byId
  }, [members])

  const blockAnnotations = useMemo(
    () => (annotations ?? []).filter((annotation) => annotation.blockId === blockId),
    [annotations, blockId]
  )
  const resolvedCount = useMemo(
    () => blockAnnotations.filter((annotation) => annotation.resolved).length,
    [blockAnnotations]
  )
  const visibleAnnotations = useMemo(
    () =>
      showResolved
        ? blockAnnotations
        : blockAnnotations.filter((annotation) => !annotation.resolved),
    [blockAnnotations, showResolved]
  )

  const sessionUserId = session?.user?.id

  const handleSubmit = () => {
    const trimmed = draft.trim()
    if (!trimmed || !sessionUserId) return
    createAnnotation.mutate({ blockId, content: trimmed, createdBy: sessionUserId })
    setDraft('')
  }

  return (
    <div className='flex flex-col pt-2 pb-1'>
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className='flex items-center gap-1.5 px-0.5 py-1.5'
        aria-expanded={isExpanded}
      >
        <MessageSquare className='size-[14px] text-[var(--text-icon)]' />
        <span className='font-medium text-[var(--text-primary)] text-small'>Comments</span>
        {blockAnnotations.length > 0 && (
          <span className='text-[var(--text-muted)] text-caption'>{blockAnnotations.length}</span>
        )}
        <ChevronDown
          className={cn(
            'ml-auto size-[14px] text-[var(--text-icon)] transition-transform duration-200',
            !isExpanded && '-rotate-90'
          )}
        />
      </button>
      {isExpanded && (
        <div className='flex flex-col'>
          {visibleAnnotations.length === 0 && (
            <p className='px-0.5 py-2 text-[var(--text-placeholder)] text-small'>
              {blockAnnotations.length === 0
                ? 'No comments on this block yet'
                : 'All comments resolved'}
            </p>
          )}
          {visibleAnnotations.map((annotation) => (
            <AnnotationItem
              key={annotation.id}
              annotation={annotation}
              author={annotation.createdBy ? membersById.get(annotation.createdBy) : undefined}
              isOwn={Boolean(sessionUserId) && annotation.createdBy === sessionUserId}
              canModerate={canModerate}
              canEdit={canEdit}
              onSaveContent={(annotationId, content) =>
                updateAnnotation.mutate({ annotationId, content })
              }
              onToggleResolved={(annotationId, resolved) =>
                updateAnnotation.mutate({ annotationId, resolved })
              }
              onDelete={(annotationId) => deleteAnnotation.mutate({ annotationId })}
            />
          ))}
          {resolvedCount > 0 && (
            <button
              type='button'
              onClick={() => setShowResolved(!showResolved)}
              className='self-start px-0.5 py-1 text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-primary)]'
            >
              {showResolved ? 'Hide resolved' : `Show resolved (${resolvedCount})`}
            </button>
          )}
          {canEdit && (
            <div className='flex flex-col gap-1.5 px-0.5 pt-1 pb-2'>
              <ChipTextarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                placeholder='Add a comment for your team'
                rows={2}
              />
              <Chip
                onClick={handleSubmit}
                disabled={!draft.trim() || createAnnotation.isPending}
                className='self-end'
              >
                Comment
              </Chip>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
