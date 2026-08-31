import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { readPausedWorkflowExecution } from '@/lib/workflows/application/read-paused-workflow-execution'
import { ResumeExecutionUnavailable } from '@/app/(interfaces)/resume/[workflowId]/[executionId]/resume-execution-unavailable'
import ResumeExecutionPage from '@/app/(interfaces)/resume/[workflowId]/[executionId]/resume-page-client'

export const metadata: Metadata = {
  title: 'Resume Execution',
  robots: { index: false },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageParams {
  workflowId: string
  executionId: string
}

export default async function ResumeExecutionPageWrapper({
  params,
  searchParams,
}: {
  params: Promise<PageParams>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams

  const { workflowId, executionId } = resolvedParams
  const initialContextIdParam = resolvedSearchParams?.contextId
  const initialContextId = Array.isArray(initialContextIdParam)
    ? initialContextIdParam[0]
    : initialContextIdParam
  const resumePath = `/resume/${encodeURIComponent(workflowId)}/${encodeURIComponent(executionId)}${
    initialContextId ? `?${new URLSearchParams({ contextId: initialContextId })}` : ''
  }`
  const session = await getSession()
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(resumePath)}`)
  }
  if (!session.session?.id) throw new Error('Authenticated session is missing its session ID')

  try {
    if (!readPausedWorkflowExecution.authorize) {
      throw new Error('Paused execution read use case does not expose authorization')
    }
    await readPausedWorkflowExecution.authorize({
      principal: {
        kind: 'session',
        userId: session.user.id,
        sessionId: session.session.id,
      },
      input: { workflowId, executionId },
    })
  } catch (error) {
    const classified = asOrchestrationError(error)
    if (classified?.code !== 'forbidden' && classified?.code !== 'not_found') throw error
    return <ResumeExecutionUnavailable />
  }

  return (
    <ResumeExecutionPage
      key={`${workflowId}:${executionId}:${initialContextId ?? ''}`}
      params={resolvedParams}
      initialContextId={initialContextId}
    />
  )
}
