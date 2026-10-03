import { SQSClient } from '@aws-sdk/client-sqs'
import type { SqsConnectionConfig } from '@/tools/sqs/types'

export function createSqsClient(config: SqsConnectionConfig): SQSClient {
  return new SQSClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
