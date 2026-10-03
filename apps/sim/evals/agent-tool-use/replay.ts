import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { OpenAICompatCreateCompletion } from '@/providers/openai-compat/streaming-tool-loop'

/**
 * Record a live model once, replay it forever.
 *
 * The model is the only thing captured. Tools stay stubbed and the loop stays
 * real, so a recorded run is a deterministic, key-free regression test for the
 * behavior a live run measured.
 */

/** One scenario's recorded transcript. */
export interface ReplayFixture {
  scenarioId: string
  model: string
  recordedAt: string
  /** One entry per model call; each holds the chunks that call streamed. */
  turns: ChatCompletionChunk[][]
}

export function replayFixturePath(directory: string, scenarioId: string): string {
  return join(directory, `${scenarioId}.json`)
}

export function writeReplayFixture(directory: string, fixture: ReplayFixture): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    replayFixturePath(directory, fixture.scenarioId),
    `${JSON.stringify(fixture, null, 2)}\n`
  )
}

export function readReplayFixture(file: string): ReplayFixture {
  return JSON.parse(readFileSync(file, 'utf8')) as ReplayFixture
}

/** Every fixture in a directory, or none when the directory does not exist yet. */
export function listReplayFixtures(directory: string): ReplayFixture[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readReplayFixture(join(directory, name)))
}

/**
 * Wraps a live completion and records the chunks each model call streams.
 * `record` runs after a turn completes, so a failed call records nothing.
 */
export function createRecordingCompletion(
  inner: OpenAICompatCreateCompletion,
  record: (turn: ChatCompletionChunk[]) => void
): OpenAICompatCreateCompletion {
  return async (params, options) => {
    const iterable = await inner(params, options)
    const chunks: ChatCompletionChunk[] = []
    return (async function* () {
      for await (const chunk of iterable) {
        chunks.push(chunk)
        yield chunk
      }
      record(chunks)
    })()
  }
}

/** Replays a fixture's recorded turns in order, one per model call. */
export function createReplayCompletion(
  turns: ChatCompletionChunk[][]
): OpenAICompatCreateCompletion {
  let index = 0
  return async () => {
    const turn = turns[index]
    index += 1
    if (!turn) {
      throw new Error(`Replay fixture exhausted after ${turns.length} model turns`)
    }
    return (async function* () {
      for (const chunk of turn) yield chunk
    })()
  }
}
