'use client'

import { useState } from 'react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Chip,
  ChipTextarea,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { formatDistanceToNow } from 'date-fns'
import { MoreHorizontal } from 'lucide-react'
import type { WorkflowAnnotationApi } from '@/lib/api/contracts'
import type { WorkspaceMember } from '@/lib/api/contracts/workspaces'
import { getUserColor } from '@/lib/workspaces/colors'

interface AnnotationItemProps {
  annotation: WorkflowAnnotationApi
  author: WorkspaceMember | undefined
  isOwn: boolean
  canModerate: boolean
  canEdit: boolean
  onSaveContent: (annotationId: string, content: string) => void
  onToggleResolved: (annotationId: string, resolved: boolean) => void
  onDelete: (annotationId: string) => void
}

export function AnnotationItem({
  annotation,
  author,
  isOwn,
  canModerate,
  canEdit,
  onSaveContent,
  onToggleResolved,
  onDelete,
}: AnnotationItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(annotation.content)

  const authorName = author?.name ?? (annotation.createdBy ? 'Unknown member' : 'Former member')
  const authorColor = getUserColor(annotation.createdBy ?? annotation.id)
  const initials = authorName.charAt(0).toUpperCase()

  const handleSave = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== annotation.content) {
      onSaveContent(annotation.id, trimmed)
    }
    setIsEditing(false)
  }

  return (
    <div className={cn('flex flex-col gap-1.5 px-0.5 py-2', annotation.resolved && 'opacity-60')}>
      <div className='flex items-center gap-1.5'>
        <Avatar size='xs'>
          {author?.image && (
            <AvatarImage
              src={author.image}
              alt={`${authorName}'s avatar`}
              referrerPolicy='no-referrer'
            />
          )}
          <AvatarFallback
            style={{ background: authorColor }}
            className='border-0 font-semibold text-[7px] text-white leading-none'
          >
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-small'>
          {authorName}
        </span>
        <span className='whitespace-nowrap text-[var(--text-muted)] text-caption'>
          {formatDistanceToNow(new Date(annotation.createdAt), { addSuffix: true })}
        </span>
        {annotation.resolved && (
          <span className='whitespace-nowrap text-[var(--text-muted)] text-caption'>Resolved</span>
        )}
        <div className='ml-auto flex items-center'>
          {canEdit && (isOwn || canModerate) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' className='p-0' aria-label='Comment actions'>
                  <MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' side='bottom' sideOffset={4}>
                {isOwn && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setDraft(annotation.content)
                      setIsEditing(true)
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onDelete(annotation.id)}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {isEditing ? (
        <div className='flex flex-col gap-1.5'>
          <ChipTextarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className='flex items-center gap-1.5'>
            <Chip onClick={handleSave} disabled={!draft.trim()}>
              Save
            </Chip>
            <Chip onClick={() => setIsEditing(false)}>Cancel</Chip>
          </div>
        </div>
      ) : (
        <p className='whitespace-pre-wrap break-words text-[var(--text-body)] text-small'>
          {annotation.content}
        </p>
      )}
      {canEdit && !isEditing && (
        <button
          type='button'
          onClick={() => onToggleResolved(annotation.id, !annotation.resolved)}
          className='self-start text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-primary)]'
        >
          {annotation.resolved ? 'Unresolve' : 'Resolve'}
        </button>
      )}
    </div>
  )
}
