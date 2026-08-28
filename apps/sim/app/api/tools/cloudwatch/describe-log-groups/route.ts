import { createLogger } from '@sim/logger'
import { cloudwatchLogGroupsSelectorContract } from '@/lib/api/contracts/selectors/cloudwatch'
import { parseToolRequest } from '@/lib/api/server'
import { createCloudWatchHttpRoute } from '@/lib/internal/cloudwatch/http-route'
import { executeCloudwatchDescribeLogGroups } from '@/lib/internal/cloudwatch/operations'

const logger = createLogger('CloudWatchDescribeLogGroups')

export const POST = createCloudWatchHttpRoute({
  logger,
  parse: (request) =>
    parseToolRequest(cloudwatchLogGroupsSelectorContract, request, {
      errorFormat: 'firstError',
      logger,
    }),
  execute: executeCloudwatchDescribeLogGroups,
  errorMessage: 'Failed to describe CloudWatch log groups',
  auth: 'session-or-internal',
})
