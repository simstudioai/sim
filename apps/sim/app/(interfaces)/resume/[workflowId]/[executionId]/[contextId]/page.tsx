import { redirect } from 'next/navigation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageParams {
  workflowId: string
  executionId: string
  contextId: string
}

export default async function ResumePage({ params }: { params: Promise<PageParams> }) {
  const { workflowId, executionId, contextId } = await params
  redirect(`/resume/${workflowId}/${executionId}?contextId=${contextId}`)
}
