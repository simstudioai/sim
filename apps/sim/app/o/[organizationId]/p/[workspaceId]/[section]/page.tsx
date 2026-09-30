import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProjectPage } from '@/app/o/[organizationId]/p/components'
import { isProjectSection } from '@/app/o/[organizationId]/p/routes'

export const metadata: Metadata = { title: 'Project' }

export default async function ProjectSectionPage({
  params,
}: {
  params: Promise<{ workspaceId: string; section: string }>
}) {
  const { workspaceId, section } = await params
  if (!isProjectSection(section)) notFound()
  return (
    <Suspense
      fallback={<p className='p-6 text-[var(--text-muted)] text-caption'>Loading project…</p>}
    >
      <ProjectPage workspaceId={workspaceId} section={section} />
    </Suspense>
  )
}
