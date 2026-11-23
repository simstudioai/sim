import { SQSClient } from '@aws-sdk/client-sqs'
import { awsClientConfig } from '@/lib/internal/aws/credentials'
import type { SqsConnectionConfig } from '@/tools/sqs/types'

export function createSqsClient(config: SqsConnectionConfig): SQSClient {
  return new SQSClient({
    ...awsClientConfig(config.region, config.accessKeyId, config.secretAccessKey),
  })
}
