import { publicWorkflowRoute } from '@/lib/workspace-files/transport/public-workflow-route'

export const GET = publicWorkflowRoute('read')
export const POST = publicWorkflowRoute('run')
