import { simOpenAiMcpContract } from '@/lib/api/contracts/sim-mcp'
import { createSimMcpHandlers } from '@/lib/api/mcp/route-handler'
import { parseRequest } from '@/lib/api/server'

export const dynamic = 'force-dynamic'

const handlers = createSimMcpHandlers('openai', (request, maxBodyBytes) =>
  parseRequest(simOpenAiMcpContract, request, {}, { maxBodyBytes })
)

export const POST = handlers.POST
export const GET = handlers.GET
export const DELETE = handlers.DELETE
