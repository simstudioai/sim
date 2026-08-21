import chalk from 'chalk'
import type { Command } from 'commander'
import { clientFrom } from '../../context'
import { type ChatResponse, V2_OPERATIONS } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { sanitize } from '../../output/render'
import { printProtocolResult } from './result'

/** The final payload, as `POST /api/v2/chat` answers it. */
type ChatResult = ChatResponse['data']

/**
 * One line of the chat NDJSON stream — the same protocol the Sim Chat block
 * consumes from the execute endpoint: heartbeats keep the connection visibly
 * alive, `chunk` events carry assistant text as it generates, and exactly one
 * `final` or `error` event ends the turn.
 */
type ChatStreamEvent =
  | { type: 'heartbeat'; timestamp?: string }
  | { type: 'chunk'; content?: string }
  | { type: 'final'; data: ChatResult }
  | { type: 'error'; error?: string }

interface ChatOptions {
  conversation?: string
}

function parseChatStreamLine(line: string): ChatStreamEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  try {
    return JSON.parse(trimmed) as ChatStreamEvent
  } catch {
    throw new SimApiError('Chat stream returned malformed data', 0)
  }
}

/**
 * Consumes the chat NDJSON stream to its final payload.
 *
 * `onChunk` receives assistant text as it arrives, already sanitized for the
 * terminal. The stream ends with exactly one `final` or `error` event; a stream
 * that ends with neither is reported rather than treated as an empty reply.
 */
async function readChatStream(
  response: Response,
  onChunk: (content: string) => void
): Promise<ChatResult> {
  if (!response.body) {
    throw new SimApiError('Chat stream ended without a response body', 0)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: ChatResult | undefined

  const processLine = (line: string): void => {
    const event = parseChatStreamLine(line)
    if (!event || event.type === 'heartbeat') return

    if (event.type === 'chunk') {
      if (event.content) onChunk(sanitize(event.content))
      return
    }

    if (event.type === 'error') {
      throw new SimApiError(event.error || 'Chat request failed', 0)
    }

    if (event.type === 'final') {
      finalResult = event.data
      return
    }

    throw new SimApiError('Chat stream returned an unknown event', 0)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        processLine(line)
      }
    }

    buffer += decoder.decode()
    processLine(buffer)

    if (!finalResult) {
      throw new SimApiError('Chat stream ended without a final result', 0)
    }

    return finalResult
  } finally {
    reader.releaseLock()
  }
}

/**
 * Adds `sim chat`.
 *
 * A protocol command rather than a generated one: the generated pass can only
 * make one JSON request, while a chat turn can run for minutes and is consumed
 * as an NDJSON stream so the reply prints as it generates and heartbeats keep
 * proxies from idling the connection out. The generated `chat` operation is
 * hidden in the CLI contract in favour of this command.
 */
export function attachChat(program: Command): void {
  program
    .command('chat')
    .description('Ask Sim and print the reply')
    .argument('<message>', 'What to ask Sim')
    .option('-c, --conversation <id>', 'Continue the conversation with this ID')
    .addHelpText(
      'after',
      `
Each turn prints the reply on stdout and the conversation ID on stderr; pass
that ID back with -c to continue the same conversation. With --output json or
yaml the reply is not streamed — the finished result is printed as one
document, conversation ID included.

Examples:
  $ sim chat "What workflows do I have?"
  $ sim chat -c 3f2a… "Which of those run on a schedule?"
  $ sim --output json chat "Summarize yesterday's failed runs" | jq -r '.content'
`
    )
    .action(async (message: string, options: ChatOptions, command: Command) => {
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()

      const response = await client.requestRaw(V2_OPERATIONS.chat.path, {
        method: 'POST',
        body: {
          workspaceId,
          message,
          ...(options.conversation ? { conversationId: options.conversation } : {}),
        },
        headers: { accept: 'application/x-ndjson' },
      })

      // Structured output waits for the finished result: a half-streamed reply
      // interleaved with a JSON document is parseable by neither human nor jq.
      const streaming = profile.output === 'table' || profile.output === 'text'
      let streamed = ''
      const result = await readChatStream(response, (content) => {
        if (!streaming) return
        streamed += content
        process.stdout.write(content)
      })

      if (!streaming) {
        printProtocolResult(profile.output, result)
        return
      }

      // A run that produced its reply without incremental chunks — or whose
      // final content outran the streamed deltas — still has to print in full.
      // Only the missing suffix is written, so nothing already on the terminal
      // repeats; a final that diverges from the stream entirely stays unprinted
      // rather than duplicating the reply.
      const content = sanitize(result.content ?? '')
      if (content.startsWith(streamed) && content.length > streamed.length) {
        process.stdout.write(content.slice(streamed.length))
        streamed = content
      }
      if (streamed.length > 0 && !streamed.endsWith('\n')) {
        process.stdout.write('\n')
      }
      process.stderr.write(`${chalk.dim(`conversation: ${result.conversationId}`)}\n`)
    })
}
