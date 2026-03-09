import { SendMessageCommand, type SendMessageCommandOutput, SQSClient } from '@aws-sdk/client-sqs'
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

export async function sendMessage(
  client: SQSClient,
  queueUrl: string,
  data: Record<string, unknown>,
  messageGroupId?: string | null,
  messageDeduplicationId?: string | null
): Promise<Record<string, unknown> | null> {
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(data),
    MessageGroupId: messageGroupId ?? undefined,
    ...(messageDeduplicationId ? { MessageDeduplicationId: messageDeduplicationId } : {}),
  })

  const response = await client.send(command)
  return parseSendMessageResponse(response)
}

function parseSendMessageResponse(
  response: SendMessageCommandOutput
): Record<string, unknown> | null {
  if (!response) {
    return null
  }

  return { id: response.MessageId }
}
