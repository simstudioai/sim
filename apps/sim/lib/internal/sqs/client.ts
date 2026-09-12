import { SQSClient } from '@aws-sdk/client-sqs'
import { createOutboundAwsHttpHandler } from '@/lib/core/network/aws-handler.server'
import type { SqsConnectionConfig } from '@/tools/sqs/types'

export function createSqsClient(config: SqsConnectionConfig): SQSClient {
  return new SQSClient({
    requestHandler: createOutboundAwsHttpHandler(),
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
