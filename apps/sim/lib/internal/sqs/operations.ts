import { createSqsClient, sendMessage } from '@/lib/internal/sqs/client'
import type { SqsSendInput } from '@/lib/internal/sqs/schema'

export async function executeSqsSend(input: SqsSendInput, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const client = createSqsClient(input)
  try {
    const result = await sendMessage(
      client,
      input.queueUrl,
      input.data,
      input.messageGroupId,
      input.messageDeduplicationId,
      signal
    )
    signal?.throwIfAborted()
    return {
      message: `Message sent to SQS queue ${input.queueUrl}`,
      id: result?.id,
    }
  } finally {
    client.destroy()
  }
}
