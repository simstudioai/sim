/**
 * Helper function to convert a DeepSeek (OpenAI-compatible) stream to a ReadableStream
 * of text chunks that can be consumed by the browser.
 */
export function createReadableStreamFromDeepseekStream(deepseekStream: any): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of deepseekStream) {
          const content = chunk.choices[0]?.delta?.content || ''
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
