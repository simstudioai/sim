import { SQSClient } from '@aws-sdk/client-sqs'
import { awsClientCredentials } from '@/lib/internal/aws/credentials'
import type { SqsConnectionConfig } from '@/tools/sqs/types'

export function createSqsClient(config: SqsConnectionConfig): SQSClient {
  return new SQSClient({
    region: config.region,
    credentials: awsClientCredentials(config.accessKeyId, config.secretAccessKey),
  })
}
