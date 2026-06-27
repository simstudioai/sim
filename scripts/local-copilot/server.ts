/**
 * Local Copilot / Mothership shim for self-hosted Sim.
 *
 * Drop-in replacement for the proprietary `simstudioai/copilot` service so the
 * Chat ("Sim agent") surface works locally. Implements the minimal slice of the
 * mothership Go API that the Sim app calls:
 *
 *   POST /api/copilot             → SSE stream of mothership-stream-v1 events
 *   POST /api/tools/resume        → SSE stream (emits `complete`; no server tools)
 *   POST /api/generate-chat-title → { title }
 *
 * It proxies the conversation to OpenAI Chat Completions (streaming) and
 * re-emits deltas as `text` events the app understands, then a `complete` event.
 * "ask"-style text replies only — it does not perform build-mode tool calls
 * (workflow construction), which require the real mothership orchestrator.
 *
 * Run: OPENAI_API_KEY=... bun run scripts/local-copilot/server.ts
 * Env: PORT (default 8787), COPILOT_API_KEY (shared secret, optional check),
 *      OPENAI_API_KEY (required), LOCAL_COPILOT_MODEL (default gpt-4o-mini).
 */

const PORT = Number(process.env.PORT || 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1 || ''
const EXPECTED_API_KEY = process.env.COPILOT_API_KEY || ''
const MODEL = process.env.LOCAL_COPILOT_MODEL || 'gpt-4o-mini'

if (!OPENAI_API_KEY) {
  console.error('[local-copilot] OPENAI_API_KEY is required')
  process.exit(1)
}

const enc = new TextEncoder()

interface CopilotBody {
  message?: string
  model?: string
  mode?: string
  messageId?: string
  chatId?: string
  userId?: string
  workspaceId?: string
  context?: Array<{ type?: string; content?: string }>
}

/** Build a mothership-stream-v1 envelope (matches createEvent in the app). */
function event(
  type: string,
  seq: number,
  streamId: string,
  requestId: string,
  payload: unknown,
  chatId?: string
) {
  return {
    v: 1,
    type,
    seq,
    ts: new Date().toISOString(),
    stream: { streamId, ...(chatId ? { chatId } : {}), cursor: String(seq) },
    trace: { requestId },
    payload,
  }
}

function sseLine(obj: unknown): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(obj)}\n\n`)
}

/** System prompt steering the shim toward useful, concise assistant replies. */
const SYSTEM_PROMPT =
  'You are Sim, the AI assistant inside the Sim AI workspace. Help the user build and reason about AI agents and workflows. Be concise and concrete. You are running through a local self-hosted copilot bridge, so you cannot directly build workflows on the canvas — when asked to build something, explain the steps and the blocks involved.'

function buildMessages(body: CopilotBody) {
  const ctx = (body.context ?? [])
    .map((c) => (c?.content ? `# ${c.type ?? 'context'}\n${c.content}` : ''))
    .filter(Boolean)
    .join('\n\n')
  const userContent = [ctx, body.message ?? ''].filter(Boolean).join('\n\n')
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent || 'Hello' },
  ]
}

async function streamCopilot(body: CopilotBody): Promise<Response> {
  const streamId = body.messageId || crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const chatId = body.chatId

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seq = 0
      const send = (type: string, payload: unknown) =>
        controller.enqueue(sseLine(event(type, ++seq, streamId, requestId, payload, chatId)))

      try {
        const oa = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: MODEL,
            stream: true,
            messages: buildMessages(body),
          }),
        })

        if (!oa.ok || !oa.body) {
          const errText = await oa.text().catch(() => '')
          send('error', {
            message: `OpenAI request failed (${oa.status})`,
            error: errText.slice(0, 500),
          })
          send('complete', { status: 'error' })
          controller.close()
          return
        }

        const reader = oa.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const raw of lines) {
            const line = raw.trim()
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const delta = json?.choices?.[0]?.delta?.content
              if (typeof delta === 'string' && delta.length > 0) {
                send('text', { channel: 'assistant', text: delta })
              }
            } catch {
              // ignore non-JSON keepalive lines
            }
          }
        }
        send('complete', { status: 'complete' })
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'stream failed' })
        send('complete', { status: 'error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

async function generateTitle(body: CopilotBody): Promise<Response> {
  try {
    const oa = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Generate a short 3-6 word title for this conversation. Reply with the title only, no quotes.',
          },
          { role: 'user', content: body.message ?? 'New chat' },
        ],
        max_tokens: 20,
      }),
    })
    const json = await oa.json().catch(() => ({}) as any)
    const title = json?.choices?.[0]?.message?.content?.trim?.() || 'New chat'
    return Response.json({ title })
  } catch {
    return Response.json({ title: 'New chat' })
  }
}

function authorized(req: Request): boolean {
  if (!EXPECTED_API_KEY) return true
  return req.headers.get('x-api-key') === EXPECTED_API_KEY
}

Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/health') return Response.json({ status: 'ok', model: MODEL })

    if (req.method !== 'POST') return new Response('Not found', { status: 404 })

    if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as CopilotBody
    console.log(`[local-copilot] POST ${path} mode=${body.mode ?? '-'} msg="${(body.message ?? '').slice(0, 60)}"`)

    if (path === '/api/copilot' || path === '/api/tools/resume') {
      return streamCopilot(body)
    }
    if (path === '/api/generate-chat-title') {
      return generateTitle(body)
    }

    // Unknown mothership endpoints (admin, billing callbacks): no-op 200 to avoid noisy errors.
    return Response.json({ ok: true })
  },
})

console.log(`[local-copilot] listening on http://localhost:${PORT} (model: ${MODEL})`)
