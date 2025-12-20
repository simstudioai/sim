/**
 * Helper to wrap Groq streaming into a browser-friendly ReadableStream
 * of raw assistant text chunks.
 *
 * @param groqStream - The Groq streaming response
 * @returns A ReadableStream that emits text chunks
 */
export function createReadableStreamFromGroqStream(groqStream: any): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of groqStream) {
          if (chunk.choices[0]?.delta?.content) {
            controller.enqueue(new TextEncoder().encode(chunk.choices[0].delta.content))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}
