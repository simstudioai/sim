'use client'

import type { ReactNode } from 'react'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import type { ProjectResources } from '@/app/playground/org/lib/use-project-resources'
import { useWorkspaceFileContent } from '@/hooks/queries/workspace-files'

interface DashboardFileProps {
  workspaceId: string
  file: ProjectResources['dashboardFiles'][number]
  title: ReactNode
}

/** A real `.dashboard` workspace file, rendered live against the workspace's tables. */
export function DashboardFile({ workspaceId, file, title }: DashboardFileProps) {
  const {
    data: content,
    isLoading,
    error,
  } = useWorkspaceFileContent(workspaceId, file.id, file.key)
  if (error)
    return (
      <p className='px-6 py-16 text-center text-[var(--text-error)] text-small'>{error.message}</p>
    )
  if (isLoading || content === undefined)
    return <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>Loading…</p>
  return (
    <DashboardPreview content={content} workspaceId={workspaceId} fileId={file.id} title={title} />
  )
}
