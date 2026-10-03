import { createLogger } from '@sim/logger'
import { confluencePageContract } from '@/lib/api/contracts/tools/confluence'
import { parseRequest } from '@/lib/api/server'
import { createConfluenceHttpRoute } from '@/lib/internal/confluence/http-route'
import { executeConfluenceRetrievePage } from '@/lib/internal/confluence/operations'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConfluencePageAPI')

export const POST = createConfluenceHttpRoute({
  logger,
  parse: (request) => parseRequest(confluencePageContract, request, {}),
  execute: executeConfluenceRetrievePage,
})
