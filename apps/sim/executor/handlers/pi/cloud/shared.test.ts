/**
 * @vitest-environment node
 */
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { MAX_SANDBOX_PROCESS_OUTPUT_BYTES } from '@/lib/execution/remote-sandbox/output-limits'
import {
  PI_SANDBOX_MAX_LIFETIME_MS,
  PI_SANDBOX_MIN_LIFETIME_MS,
} from '@/lib/execution/remote-sandbox/pi-lifetime'
import {
  PI_EVENT_FILTER_PATH,
  PI_EVENT_FILTER_SOURCE,
} from '@/executor/handlers/pi/cloud/event-filter-source'
import {
  buildPiScript,
  CLONE_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
  MIN_PI_TIMEOUT_MS,
  resolvePiTimeoutMs,
} from '@/executor/handlers/pi/cloud/shared'
import { normalizePiEvent } from '@/executor/handlers/pi/core/events'

async function runPiEventFilter(chunks: Array<string | Uint8Array>): Promise<string> {
  const child = spawn('node', ['--input-type=module', '--eval', PI_EVENT_FILTER_SOURCE], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  const completed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  for (const chunk of chunks) child.stdin.write(chunk)
  child.stdin.end()

  const exitCode = await completed
  if (exitCode !== 0) throw new Error(`Pi event filter exited ${exitCode}: ${stderr}`)
  return stdout
}

function parseJsonLines(output: string): Array<Record<string, unknown>> {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('resolvePiTimeoutMs', () => {
  it('reserves every command budget that brackets the agent turn', () => {
    // Capping at the bare sandbox lifetime would mean the sandbox always died
    // first, taking the agent's finished work with it unpushed. Create PR runs
    // three bracketing commands, and the commit and the push each get the full
    // finalize budget — reserving only one of them leaves the push unbudgeted,
    // which is exactly when losing the sandbox costs the most.
    const timeout = resolvePiTimeoutMs(PI_SANDBOX_MAX_LIFETIME_MS)
    expect(timeout).toBeLessThanOrEqual(
      PI_SANDBOX_MAX_LIFETIME_MS - CLONE_TIMEOUT_MS - 2 * FINALIZE_TIMEOUT_MS
    )
    expect(timeout).toBeGreaterThan(0)
  })

  it('reserves against the lifetime it is given, not the provider ceiling', () => {
    // The whole point of taking an argument: a run whose execution deadline is
    // shorter than the ceiling gets a sandbox that short, so reserving against
    // the ceiling would hand the agent a turn longer than its own sandbox lives
    // — the exact bug the reserve exists to prevent.
    const shortLifetime = PI_SANDBOX_MAX_LIFETIME_MS / 2
    expect(resolvePiTimeoutMs(shortLifetime)).toBeLessThan(
      resolvePiTimeoutMs(PI_SANDBOX_MAX_LIFETIME_MS)
    )
    expect(resolvePiTimeoutMs(shortLifetime)).toBeLessThanOrEqual(shortLifetime)
  })

  it('does not reserve nonexistent finalize phases for Plan', () => {
    const timeout = resolvePiTimeoutMs(PI_SANDBOX_MAX_LIFETIME_MS, { finalizePhases: 0 })

    expect(timeout).toBeLessThanOrEqual(PI_SANDBOX_MAX_LIFETIME_MS - CLONE_TIMEOUT_MS)
    expect(timeout).toBeGreaterThan(resolvePiTimeoutMs(PI_SANDBOX_MAX_LIFETIME_MS))
  })

  it('falls back to the single-turn floor when the reserves exhaust the lifetime', () => {
    // A deadline shorter than the bracketing commands' worst case is legitimate
    // (a free-plan sync run). Those ceilings are pessimistic, so leave a short
    // turn rather than a negative one.
    expect(resolvePiTimeoutMs(CLONE_TIMEOUT_MS)).toBe(MIN_PI_TIMEOUT_MS)
  })

  it('keeps the lifetime floor above the reserves it exists to protect', () => {
    // The floor lives next to the lifetime and the reserves live here, so
    // without this they can drift until a permitted lifetime leaves the agent
    // turn with nothing but its own minimum.
    expect(PI_SANDBOX_MIN_LIFETIME_MS).toBeGreaterThanOrEqual(
      CLONE_TIMEOUT_MS + 2 * FINALIZE_TIMEOUT_MS + MIN_PI_TIMEOUT_MS
    )
  })
})

describe('buildPiScript', () => {
  it('disables every repository-supplied Pi resource for Babysit with or without search', () => {
    for (const script of [
      buildPiScript(undefined, { disableRepositoryResources: true }),
      buildPiScript('/workspace/search.ts', { disableRepositoryResources: true }),
    ]) {
      expect(script).toContain('--no-extensions')
      expect(script).toContain('--no-prompt-templates')
      expect(script).toContain('--no-skills')
      expect(script).toContain('--no-approve')
    }
    expect(buildPiScript('/workspace/search.ts', { disableRepositoryResources: true })).toContain(
      '-e /workspace/search.ts'
    )
  })

  it('preserves Create PR repository-resource behavior when no hardening option is passed', () => {
    expect(buildPiScript()).not.toContain('--no-extensions')
    expect(buildPiScript()).not.toContain('--no-prompt-templates')
  })

  it('filters Pi output inside the sandbox without masking pipeline failures', () => {
    const script = buildPiScript()
    expect(script).toMatch(/^\/bin\/bash -o pipefail -c '/)
    expect(script).toContain(`| node ${PI_EVENT_FILTER_PATH}`)
    expect(PI_EVENT_FILTER_PATH.startsWith('/workspace/repo')).toBe(false)
  })
})

describe('PI_EVENT_FILTER_SOURCE', () => {
  it('preserves every meaningful normalized event while removing cumulative payloads', async () => {
    const rawEvents = [
      {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'large history' }] },
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
      {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'large thought' }] },
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      },
      { type: 'tool_execution_start', toolName: 'bash', args: { command: 'large command' } },
      {
        type: 'tool_execution_end',
        toolName: 'bash',
        result: { content: 'large result' },
        isError: true,
      },
      {
        type: 'turn_end',
        usage: { inputTokens: 3, outputTokens: 4, ignored: 'provider detail' },
        message: { usage: { input: 5, output: 6 }, content: 'large message' },
        toolResults: [{ content: 'large tool result' }],
      },
      {
        type: 'agent_end',
        willRetry: true,
        messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'retry me' }],
      },
      {
        type: 'agent_end',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'old prompt' }] },
          {
            role: 'assistant',
            stopReason: 'stop',
            content: [
              { type: 'thinking', thinking: 'private reasoning' },
              { type: 'text', text: 'final answer' },
            ],
          },
        ],
      },
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason: 'aborted', errorMessage: 'stopped' }],
      },
      { type: 'error', error: 'provider failed', details: { response: 'large response' } },
      { type: 'tool_execution_update', partialResult: { content: 'unused progress' } },
    ]
    const output = parseJsonLines(
      await runPiEventFilter([`${rawEvents.map((event) => JSON.stringify(event)).join('\n')}\n`])
    )

    const meaningful = (events: unknown[]) =>
      events.map(normalizePiEvent).filter((event) => event !== null && event.type !== 'other')
    expect(meaningful(output)).toEqual(meaningful(rawEvents))

    const update = output.find((event) => event.type === 'message_update')
    expect(update).not.toHaveProperty('message')
    const toolStart = output.find((event) => event.type === 'tool_execution_start')
    expect(toolStart).not.toHaveProperty('args')
    const toolEnd = output.find((event) => event.type === 'tool_execution_end')
    expect(toolEnd).not.toHaveProperty('result')
    const completed = output.find(
      (event) =>
        event.type === 'agent_end' &&
        Array.isArray(event.messages) &&
        event.messages.length > 0 &&
        (event.messages[0] as { stopReason?: string }).stopReason === 'stop'
    )
    // Reduced to the one message `normalizePiEvent` inspects and only the fields it reads. Keeping
    // the final text once lets Plan replace streamed progress with the authoritative final answer;
    // the transcript, thinking blocks, and tool payloads still go.
    expect(completed).toEqual({
      type: 'agent_end',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'final answer' }],
          stopReason: 'stop',
        },
      ],
    })
    expect(output.some((event) => event.type === 'tool_execution_update')).toBe(false)
  })

  it('ignores malformed lines, accepts an unterminated final line, and preserves split UTF-8', async () => {
    const line = Buffer.from(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello 🙂' },
      })
    )
    const emojiStart = line.indexOf(Buffer.from('🙂'))
    expect(emojiStart).toBeGreaterThan(0)
    const output = parseJsonLines(
      await runPiEventFilter([
        '{not json}\n',
        line.subarray(0, emojiStart + 1),
        line.subarray(emojiStart + 1, emojiStart + 3),
        line.subarray(emojiStart + 3),
      ])
    )

    expect(output).toEqual([
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello 🙂' },
      },
    ])
  })

  it('keeps a cumulative stream over the sandbox limit compact without changing totals', async () => {
    const totalCharacters = 12_000
    const delta = 'xxxx'
    const lines: string[] = []
    for (let length = delta.length; length <= totalCharacters; length += delta.length) {
      lines.push(
        JSON.stringify({
          type: 'message_update',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'x'.repeat(length) }],
          },
          assistantMessageEvent: { type: 'text_delta', delta },
        })
      )
    }
    lines.push(
      JSON.stringify({
        type: 'turn_end',
        message: { usage: { input: 10, output: 20 } },
        toolResults: [{ content: 'x'.repeat(totalCharacters) }],
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'read',
        result: { content: 'x'.repeat(totalCharacters) },
        isError: false,
      }),
      JSON.stringify({
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'x'.repeat(totalCharacters) }],
          },
        ],
      })
    )
    const raw = `${lines.join('\n')}\n`
    expect(Buffer.byteLength(raw)).toBeGreaterThan(MAX_SANDBOX_PROCESS_OUTPUT_BYTES)

    const filtered = await runPiEventFilter([raw])
    expect(Buffer.byteLength(filtered)).toBeLessThan(MAX_SANDBOX_PROCESS_OUTPUT_BYTES)
    const events = parseJsonLines(filtered)
      .map(normalizePiEvent)
      .filter((event) => event !== null)
    const text = events
      .filter((event) => event.type === 'text')
      .map((event) => event.text)
      .join('')
    expect(text).toHaveLength(totalCharacters)
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 20 })
    expect(events).toContainEqual({ type: 'tool_end', toolName: 'read', isError: false })
    expect(events).toContainEqual({ type: 'final', text: 'x'.repeat(totalCharacters) })
  })
})
