import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import ResumeExecutionPage from './resume-page-client'

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

  const detail = await PauseResumeManager.getPausedExecutionDetail({
    workflowId,
    executionId,
  })

  return (
    <ResumeExecutionPage
      params={resolvedParams}
      initialExecutionDetail={detail ? JSON.parse(JSON.stringify(detail)) : null}
      initialContextId={initialContextId}
    />
  )
}
