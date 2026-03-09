'use client'

import { useMemo } from 'react'
import { Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { FileViewer } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { Table } from '@/app/workspace/[workspaceId]/tables/[tableId]/components'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

interface MothershipViewProps {
  workspaceId: string
  resources: MothershipResource[]
  activeResourceId: string | null
  onSelectResource: (id: string) => void
}

export function MothershipView({
  workspaceId,
  resources,
  activeResourceId,
  onSelectResource,
}: MothershipViewProps) {
  const active = resources.find((r) => r.id === activeResourceId) ?? resources[0] ?? null

  return (
    <div className='flex h-full w-[50%] min-w-[400px] flex-col border-[var(--border)] border-l'>
      <div className='flex shrink-0 gap-[2px] overflow-x-auto border-[var(--border)] border-b px-[12px]'>
        {resources.map((r) => (
          <button
            key={r.id}
            type='button'
            onClick={() => onSelectResource(r.id)}
            className={cn(
              'shrink-0 cursor-pointer border-b-[2px] px-[12px] py-[10px] text-[13px] transition-colors',
              active?.id === r.id
                ? 'border-[var(--text-primary)] font-medium text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div className='min-h-0 flex-1 overflow-hidden'>
        {active?.type === 'table' && (
          <Table key={active.id} workspaceId={workspaceId} tableId={active.id} embedded />
        )}
        {active?.type === 'file' && (
          <EmbeddedFile key={active.id} workspaceId={workspaceId} fileId={active.id} />
        )}
      </div>
    </div>
  )
}

interface EmbeddedFileProps {
  workspaceId: string
  fileId: string
}

function EmbeddedFile({ workspaceId, fileId }: EmbeddedFileProps) {
  const { data: files = [], isLoading } = useWorkspaceFiles(workspaceId)
  const file = useMemo(() => files.find((f) => f.id === fileId), [files, fileId])

  if (isLoading) {
    return (
      <div className='flex h-full flex-col gap-[8px] p-[24px]'>
        <Skeleton className='h-[16px] w-[60%]' />
        <Skeleton className='h-[16px] w-[80%]' />
        <Skeleton className='h-[16px] w-[40%]' />
      </div>
    )
  }

  if (!file) {
    return (
      <div className='flex h-full items-center justify-center'>
        <span className='text-[13px] text-[var(--text-muted)]'>File not found</span>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <FileViewer key={file.id} file={file} workspaceId={workspaceId} canEdit={true} />
    </div>
  )
}
