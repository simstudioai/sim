/**
 * Helper to convert a Cerebras streaming response (async iterable) into a ReadableStream.
 * Enqueues only the model's text delta chunks as UTF-8 encoded bytes.
 */
export function createReadableStreamFromCerebrasStream(
  cerebrasStream: AsyncIterable<any>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of cerebrasStream) {
          const content = chunk.choices?.[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
          }
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
