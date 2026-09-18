import { createSimMcpHandlers } from '@/lib/api/mcp/route-handler'

export const dynamic = 'force-dynamic'

const handlers = createSimMcpHandlers()

export const POST = handlers.POST
export const GET = handlers.GET
export const DELETE = handlers.DELETE
