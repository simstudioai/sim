import { PauseResumeManager } from '@/lib/workflows/executor/pause-resume-manager'
import ResumeClientPage from './resume-page-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageParams {
  workflowId: string
  executionId: string
  contextId: string
}

export default async function ResumePage({
  params,
}: {
  params: PageParams
}) {
  const { workflowId, executionId, contextId } = params

  const detail = await PauseResumeManager.getPauseContextDetail({
    workflowId,
    executionId,
    contextId,
  })

  return (
    <ResumeClientPage
      params={params}
      initialDetail={detail ? JSON.parse(JSON.stringify(detail)) : null}
    />
  )
}
