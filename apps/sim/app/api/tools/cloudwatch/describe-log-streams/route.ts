import { createLogger } from '@sim/logger'
import { cloudwatchLogStreamsContract } from '@/lib/api/contracts/tools/cloudwatch'
import { parseToolRequest } from '@/lib/api/server'
import { createCloudWatchHttpRoute } from '@/lib/internal/cloudwatch/http-route'
import { executeCloudwatchDescribeLogStreams } from '@/lib/internal/cloudwatch/operations'

const logger = createLogger('CloudWatchDescribeLogStreams')

export const POST = createCloudWatchHttpRoute({
  logger,
  parse: (request) =>
    parseToolRequest(cloudwatchLogStreamsContract, request, {
      errorFormat: 'firstError',
      logger,
    }),
  execute: executeCloudwatchDescribeLogStreams,
  errorMessage: 'Failed to describe CloudWatch log streams',
  auth: 'session-or-internal',
})
