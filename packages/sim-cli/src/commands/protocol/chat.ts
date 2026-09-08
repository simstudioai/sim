import chalk from 'chalk'
import type { Command } from 'commander'
import { clientFrom } from '../../context'
import { type ChatResponse, V2_OPERATIONS } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { readNdjson } from '../../http/ndjson'
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

/**
 * Consumes the chat NDJSON stream to its final payload.
 *
 * `onChunk` receives assistant text as it arrives, already sanitized for the
 * terminal. The stream ends with exactly one `final` or `error` event, and
 * reading stops there rather than waiting for the body to close — a server or
 * intermediary that holds the connection open past the turn must not hang the
 * CLI. A stream that ends with neither event is reported rather than treated as
 * an empty reply.
 */
async function readChatStream(
  response: Response,
  onChunk: (content: string) => void
): Promise<ChatResult> {
  for await (const value of readNdjson(response.body, 'Chat stream')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new SimApiError('Chat stream returned an unknown event', 0)
    }
    const event = value as ChatStreamEvent
    if (event.type === 'heartbeat') continue

    if (event.type === 'chunk') {
      if (event.content) onChunk(sanitize(event.content))
      continue
    }

    if (event.type === 'error') {
      throw new SimApiError(event.error || 'Chat request failed', 0)
    }

    if (event.type === 'final') {
      return event.data
    }

    throw new SimApiError('Chat stream returned an unknown event', 0)
  }
  throw new SimApiError('Chat stream ended without a final result', 0)
}

/**
 * Silences the broken pipe a progressively written reply hits when its reader
 * leaves early — `sim chat … | head`, `| grep -q`, quitting `| less`. Node
 * surfaces that as an asynchronous `EPIPE` error event on the stream, which
 * with no listener crashes with a stack trace; a SIGPIPE-aware CLI just stops.
 * Every other write failure is left to surface as the crash it is.
 *
 * Returns a disposer that removes the handling again.
 */
function ignoreBrokenPipe(stream: NodeJS.WriteStream): () => void {
  const onError = (error: NodeJS.ErrnoException): void => {
    if (error.code !== 'EPIPE') throw error
    process.exit(0)
  }
  stream.on('error', onError)
  return () => {
    stream.off('error', onError)
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
    .allowExcessArguments(false)
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
      /**
       * Refused here so the refusal names what the caller typed: the route
       * answers in its own field names, and this command builds its request by
       * hand, so nothing retypes them into `<message>` and `-c/--conversation`.
       * A blank `-c` was worse than misnamed — it is falsy, so it was dropped
       * from the body and silently started a NEW conversation instead of
       * continuing one.
       */
      if (message.trim() === '') {
        throw new SimApiError('<message> cannot be empty', 0)
      }
      if (options.conversation !== undefined && options.conversation.trim() === '') {
        throw new SimApiError(
          '-c/--conversation cannot be empty — pass the conversation id printed on stderr after each turn',
          0
        )
      }

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

      /** Closes off streamed text so nothing is glued onto the line after it. */
      const endStreamedLine = (): void => {
        if (streamed.length > 0 && !streamed.endsWith('\n')) {
          process.stdout.write('\n')
          streamed += '\n'
        }
      }

      const restorePipeHandling = streaming ? ignoreBrokenPipe(process.stdout) : undefined

      try {
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
        endStreamedLine()
        process.stderr.write(`${chalk.dim(`conversation: ${result.conversationId}`)}\n`)
      } catch (error) {
        endStreamedLine()
        throw error
      } finally {
        restorePipeHandling?.()
      }
    })
}
