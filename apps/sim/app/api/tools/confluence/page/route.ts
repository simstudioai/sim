import { createLogger } from '@sim/logger'
import { confluencePageSelectorContract } from '@/lib/api/contracts/selectors/confluence'
import { parseRequest } from '@/lib/api/server'
import { createConfluenceHttpRoute } from '@/lib/internal/confluence/http-route'
import { executeConfluenceRetrievePage } from '@/lib/internal/confluence/operations'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConfluencePageAPI')

export const POST = createConfluenceHttpRoute({
  logger,
  parse: (request) => parseRequest(confluencePageSelectorContract, request, {}),
  execute: executeConfluenceRetrievePage,
})
