import { describe, expect, it } from 'vitest'
import { RedditBlock } from '@/blocks/blocks/reddit'

/** Runs the mapper the way an agent tool call does: its output spreads over the merged params. */
function runToolCall(args: Record<string, unknown>, operation: string) {
  const mapper = RedditBlock.tools.config?.params
  if (!mapper) throw new Error('Reddit block has no params mapper')
  return { ...args, ...mapper(args, { operation }) }
}

describe('RedditBlock tool-call params', () => {
  it('keeps the model time window for controversial posts', () => {
    const params = runToolCall({ subreddit: 'news', time: 'week', limit: 10 }, 'get_controversial')

    expect(params).toMatchObject({ subreddit: 'news', time: 'week', limit: 10 })
  })

  it('submits the model post body and typed flags without the block-only post type', () => {
    const params = runToolCall(
      { subreddit: 'test', title: 'Hello', text: 'Body', nsfw: true, send_replies: false },
      'submit_post'
    )

    expect(params).toMatchObject({
      subreddit: 'test',
      title: 'Hello',
      text: 'Body',
      nsfw: true,
      spoiler: false,
      send_replies: false,
    })
  })

  it('keeps the model vote direction', () => {
    const params = runToolCall({ id: 't3_abc', dir: -1 }, 'vote')

    expect(params).toMatchObject({ id: 't3_abc', dir: -1 })
  })
})
