import { notFound, redirect } from 'next/navigation'
import { internalSessionAuth } from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { getProject } from '@/lib/projects/application/use-cases'
import { getProjectFileMetadata } from '@/lib/projects/files/application'
import { isProjectFileApiEnabled } from '@/lib/projects/rollout.server'

interface ProjectFilePageProps {
  params: Promise<{ projectId: string; fileId: string }>
}

/** Resolves a durable Project link into an environment the current viewer can access. */
export default async function ProjectFilePage({ params }: ProjectFilePageProps) {
  if (!(await isProjectFileApiEnabled())) notFound()
  const { projectId, fileId } = await params
  if (!(await getSession())?.user) {
    const destination = `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
    redirect(`/login?callbackUrl=${encodeURIComponent(destination)}`)
  }
  const principal = await internalSessionAuth.authenticate()
  let workspaceId: string | undefined
  try {
    const [context] = await Promise.all([
      getProject.execute({ principal, input: { projectId } }),
      getProjectFileMetadata.execute({ principal, input: { projectId, fileId } }),
    ])
    workspaceId = context.project.environments[0]?.id
  } catch (error) {
    const classified = asOrchestrationError(error)
    if (classified?.code === 'not_found' || classified?.code === 'forbidden') notFound()
    throw error
  }
  if (!workspaceId) notFound()
  redirect(
    `/workspace/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}?owner=project&projectId=${encodeURIComponent(projectId)}`
  )
}
