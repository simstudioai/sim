import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * Stands in for the Mothership worker at the main app's `SIM_AGENT_API_URL`, so a chat turn crosses
 * every real boundary of the app and only the model's words are scripted. A message containing
 * `Count slowly` streams until the app hangs up, which is what Stop needs; anything else answers at
 * once. Same wire format as the desktop suite's `ScriptedAgent`.
 */
const port = Number(process.argv[2])
if (!port) throw new Error('usage: scripted-agent.ts <port>')

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function streamTurn(body: Record<string, unknown>, response: ServerResponse) {
  const message = typeof body.message === 'string' ? body.message : ''
  const streamId = typeof body.messageId === 'string' ? body.messageId : `${Date.now()}`
  const chatId = typeof body.chatId === 'string' ? body.chatId : undefined
  let seq = 0
  let open = true
  const emit = (type: string, payload: Record<string, unknown>) => {
    if (!open) return
    seq += 1
    const envelope = {
      v: 1,
      type,
      seq,
      ts: new Date().toISOString(),
      stream: { streamId, ...(chatId ? { chatId } : {}), cursor: String(seq) },
      trace: { requestId: `live-${streamId}` },
      payload,
    }
    response.write(`data: ${JSON.stringify(envelope)}\n\n`)
  }
  const finish = () => {
    if (!open) return
    emit('complete', { status: 'complete' })
    open = false
    response.end()
  }
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  response.on('close', () => {
    open = false
  })
  emit('session', { kind: 'start' })
  if (!message.includes('Count slowly')) {
    emit('text', { channel: 'assistant', text: 'Hello from the scripted agent.' })
    finish()
    return
  }
  let count = 0
  const timer = setInterval(() => {
    count += 1
    if (!open || count > 50) {
      clearInterval(timer)
      finish()
      return
    }
    emit('text', { channel: 'assistant', text: `${count}\n` })
  }, 500)
}

createServer((request, response) => {
  void readJson(request)
    .then((body) => {
      const path = new URL(request.url ?? '/', 'http://agent').pathname
      if (path === '/api/mothership' || path === '/api/copilot') {
        streamTurn(body, response)
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify(
          path === '/api/generate-chat-title' ? { title: 'Scripted chat' } : { settled: true }
        )
      )
    })
    .catch(() => {
      response.writeHead(500)
      response.end()
    })
}).listen(port, '127.0.0.1')
