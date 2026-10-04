import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import {
  createRecordingCompletion,
  createReplayCompletion,
  listReplayFixtures,
  replayFixturePath,
  writeReplayFixture,
} from '@/evals/agent-tool-use/replay'
import type { OpenAICompatCreateCompletion } from '@/providers/openai-compat/streaming-tool-loop'

function chunk(text: string): ChatCompletionChunk {
  return {
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop', logprobs: null }],
  }
}

/** A completion that yields each turn's chunks, one turn per call. */
function stagedCompletion(turns: ChatCompletionChunk[][]): OpenAICompatCreateCompletion {
  let index = 0
  return async () => {
    const turn = turns[index]
    index += 1
    return (async function* () {
      for (const item of turn) yield item
    })()
  }
}

async function drain(iterable: AsyncIterable<ChatCompletionChunk>): Promise<ChatCompletionChunk[]> {
  const seen: ChatCompletionChunk[] = []
  for await (const item of iterable) seen.push(item)
  return seen
}

describe('replay primitives', () => {
  it('record then replay preserves every chunk of every turn', async () => {
    const original = [[chunk('a'), chunk('b')], [chunk('c')]]
    const recorded: ChatCompletionChunk[][] = []
    const recording = createRecordingCompletion(stagedCompletion(original), (turn) =>
      recorded.push(turn)
    )

    const first = await drain(await recording({} as never))
    const second = await drain(await recording({} as never))

    expect(first).toEqual(original[0])
    expect(second).toEqual(original[1])
    expect(recorded).toEqual(original)

    const replay = createReplayCompletion(recorded)
    expect(await drain(await replay({} as never))).toEqual(original[0])
    expect(await drain(await replay({} as never))).toEqual(original[1])
  })

  it('rejects when the fixture is exhausted', async () => {
    const replay = createReplayCompletion([[chunk('only')]])
    await drain(await replay({} as never))
    await expect(async () => replay({} as never)).rejects.toThrow(
      'Replay fixture exhausted after 1 model turns'
    )
  })

  it('writes and lists fixtures from a directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eval-replay-'))
    try {
      writeReplayFixture(directory, {
        scenarioId: 'single-tool-lookup',
        model: 'deepseek-chat',
        recordedAt: '2026-01-01T00:00:00.000Z',
        turns: [[chunk('a')]],
        judgeModel: 'deepseek-chat',
        judgeTurns: [[chunk('judge')]],
      })

      expect(existsSync(replayFixturePath(directory, 'single-tool-lookup'))).toBe(true)
      const fixtures = listReplayFixtures(directory)
      expect(fixtures).toHaveLength(1)
      expect(fixtures[0]).toMatchObject({
        scenarioId: 'single-tool-lookup',
        model: 'deepseek-chat',
        judgeModel: 'deepseek-chat',
      })
      expect(fixtures[0].turns).toEqual([[chunk('a')]])
      expect(fixtures[0].judgeTurns).toEqual([[chunk('judge')]])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('returns no fixtures for a missing directory', () => {
    expect(listReplayFixtures(join(tmpdir(), 'eval-replay-does-not-exist'))).toEqual([])
  })
})
