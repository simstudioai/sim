import { createKnowledgeMcpHandlers } from '@/lib/knowledge/mcp/route-handler'

export const dynamic = 'force-dynamic'

const handlers = createKnowledgeMcpHandlers('workspace')

export const POST = handlers.POST
export const GET = handlers.GET
export const DELETE = handlers.DELETE
