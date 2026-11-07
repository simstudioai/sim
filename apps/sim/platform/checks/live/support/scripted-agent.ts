import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * Stands in for the Mothership worker at the main app's `SIM_AGENT_API_URL`, so a chat turn crosses
 * every real boundary of the app and only the model's words are scripted. A message containing
 * `Count slowly` streams until the app hangs up, which is what Stop needs; anything else answers at
 * once. Same wire format as the desktop suite's `ScriptedAgent`.
 *
 * Steering follows the worker's v2 contract (`/api/streams/steer/v2`): a message steered into a
 * running count is applied at its next number, with a `run`/`steering_applied` frame and a reply
 * that quotes it. A count asked to `ignore steering` finishes without applying any, so each one it
 * held is `not_applied`. Every disposition is durable: re-sending a steering id reads it again, and
 * `/disposition` reads it without sending (`unknown` for an id a live run never received).
 */
const port = Number(process.argv[2])
if (!port) throw new Error('usage: scripted-agent.ts <port>')

interface Steering {
  streamId: string
  content: string
  status: 'queued' | 'applied' | 'not_applied'
  /** Where it applied: its frame's seq and the answer's length then, as the worker reports. */
  eventSeq?: number
  textOffset?: number
}

const steerings = new Map<string, Steering>()
const openStreams = new Set<string>()

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
  let answerLength = 0
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
    if (type === 'text' && typeof payload.text === 'string') answerLength += payload.text.length
  }
  const finish = () => {
    if (!open) return
    emit('complete', { status: 'complete' })
    open = false
    closeSteerings()
    response.end()
  }
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  openStreams.add(streamId)
  const ignoresSteering = /ignore steering/i.test(message)
  const closeSteerings = () => {
    openStreams.delete(streamId)
    for (const steering of steerings.values()) {
      if (steering.streamId === streamId && steering.status === 'queued') {
        steering.status = 'not_applied'
      }
    }
  }
  const applySteerings = () => {
    if (ignoresSteering) return
    for (const [steeringId, steering] of steerings) {
      if (steering.streamId !== streamId || steering.status !== 'queued') continue
      steering.status = 'applied'
      steering.eventSeq = seq + 1
      steering.textOffset = answerLength
      emit('run', {
        kind: 'steering_applied',
        steeringId,
        eventSeq: steering.eventSeq,
        textOffset: steering.textOffset,
      })
      emit('text', { channel: 'assistant', text: `Applied: ${steering.content}\n` })
    }
  }
  response.on('close', () => {
    open = false
    closeSteerings()
  })
  emit('session', { kind: 'start' })
  if (!message.includes('Count slowly')) {
    emit('text', { channel: 'assistant', text: 'Hello from the scripted agent.' })
    finish()
    return
  }
  const last = Number(/to (\d+)/.exec(message)?.[1] ?? 50)
  let count = 0
  const timer = setInterval(() => {
    count += 1
    if (!open || count > last) {
      clearInterval(timer)
      finish()
      return
    }
    applySteerings()
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
      if (path === '/api/streams/steer/v2/disposition') {
        const steeringId = String(body.steeringId)
        const steering = steerings.get(steeringId)
        const status =
          steering?.status ?? (openStreams.has(String(body.messageId)) ? 'unknown' : 'not_applied')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            steeringId,
            status,
            ...(steering?.status === 'applied'
              ? { eventSeq: steering.eventSeq, textOffset: steering.textOffset }
              : {}),
          })
        )
        return
      }
      if (path === '/api/streams/steer/v2') {
        const steeringId = String(body.steeringId)
        const content = String(body.content)
        const streamId = String(body.messageId)
        let steering = steerings.get(steeringId)
        if (steering && steering.content !== content) {
          response.writeHead(409)
          response.end()
          return
        }
        if (!steering) {
          steering = {
            streamId,
            content,
            status: openStreams.has(streamId) ? 'queued' : 'not_applied',
          }
          steerings.set(steeringId, steering)
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            steeringId,
            status: steering.status,
            ...(steering.status === 'applied'
              ? { eventSeq: steering.eventSeq, textOffset: steering.textOffset }
              : {}),
          })
        )
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
