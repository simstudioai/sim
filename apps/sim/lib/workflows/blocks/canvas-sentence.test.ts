import { describe, expect, it } from 'vitest'
import {
  estimateSentenceLines,
  resolveCanvasSentence,
} from '@/lib/workflows/blocks/canvas-sentence'
import { getDisplayValue } from '@/lib/workflows/subblocks/display'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

type TestConfig = Pick<BlockConfig, 'canvasPresentation' | 'subBlocks'>

function createConfig(
  sentences: NonNullable<NonNullable<BlockConfig['canvasPresentation']>['sentences']>,
  subBlocks: Array<string | Partial<SubBlockConfig>> = ['operation'],
  operationSubBlockId?: string
): TestConfig {
  return {
    canvasPresentation: { defaultTitle: 'Test', operationSubBlockId, sentences },
    subBlocks: subBlocks.map((entry) =>
      typeof entry === 'string' ? { id: entry, type: 'short-input' } : entry
    ),
  } as TestConfig
}

/** Renders segments to a readable string so assertions read like the card. */
function render(segments: ReturnType<typeof resolveCanvasSentence>): string {
  if (!segments) return ''
  return segments
    .map((segment) => (typeof segment === 'string' ? segment : `⟨${segment.subBlockId}⟩`))
    .join(' ')
}

/** Renders a slot as the card paints it: its value, or its noun while empty. */
function renderAsCard(
  segments: ReturnType<typeof resolveCanvasSentence>,
  filled: string[]
): string {
  if (!segments) return ''
  return segments
    .map((segment) => {
      if (typeof segment === 'string') return segment
      return filled.includes(segment.subBlockId)
        ? `⟨${segment.subBlockId}⟩`
        : `⟨${segment.noun ?? ''}⟩`
    })
    .join(' ')
}

const has =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id)

/**
 * The on-card lookup: returns the definition, not a yes/no, so the resolver can
 * take a slot's noun from the definition this operation actually shows.
 */
const onCard =
  (config: TestConfig, ...hiddenIds: string[]) =>
  (id: string) =>
    config.subBlocks.find((sb) => sb.id === id && !hiddenIds.includes(id)) ?? null
const none = () => null

describe('resolveCanvasSentence', () => {
  it('keeps a core clause on an untouched card, standing the field noun in for the value', () => {
    /* The whole point of `core`: a fresh card reads as a sentence, not as nothing. */
    const config = createConfig({ default: [{ text: 'Post', field: 'message', core: true }] }, [
      { id: 'message', type: 'short-input', title: 'Message' },
    ])

    expect(
      renderAsCard(
        resolveCanvasSentence(
          config,
          { mode: 'action', operationValue: undefined },
          has('message'),
          onCard(config)
        ),
        ['message']
      )
    ).toBe('Post ⟨message⟩')
    expect(
      renderAsCard(
        resolveCanvasSentence(
          config,
          { mode: 'action', operationValue: undefined },
          has(),
          onCard(config)
        ),
        []
      )
    ).toBe('Post ⟨a message⟩')
  })

  it('drops a core clause whose field this operation never shows', () => {
    /* Visibility, not just emptiness — a clause gated to another operation has
       no slot to hold on this card. */
    const config = createConfig({ default: [{ text: 'Post', field: 'message', core: true }] }, [
      { id: 'message', type: 'short-input', title: 'Message' },
    ])

    expect(
      resolveCanvasSentence(config, { mode: 'action', operationValue: undefined }, has(), none)
    ).toBeNull()
  })

  it('drops an optional clause whole, taking its connective with it', () => {
    /* The failure this prevents is a dangling "…, where" with no value. */
    const config = createConfig(
      {
        default: [
          { text: 'Query rows from', field: 'table', core: true },
          { text: ', where', field: 'filter' },
          { text: ', up to', field: 'limit', after: 'rows' },
        ],
      },
      ['table', 'filter', 'limit']
    )

    expect(
      render(
        resolveCanvasSentence(
          config,
          { mode: 'action', operationValue: undefined },
          has('table'),
          onCard(config)
        )
      )
    ).toBe('Query rows from ⟨table⟩')
    expect(
      render(
        resolveCanvasSentence(
          config,
          { mode: 'action', operationValue: undefined },
          has('table', 'limit'),
          onCard(config)
        )
      )
    ).toBe('Query rows from ⟨table⟩ , up to ⟨limit⟩ rows')
  })

  it('selects the sentence for the current operation', () => {
    const config = createConfig(
      {
        byOperation: {
          send: [{ text: 'Send an email to', field: 'to', core: true }],
          search: [{ text: 'Search email for', field: 'query', core: true }],
        },
      },
      ['operation', 'to', 'query']
    )

    expect(
      render(
        resolveCanvasSentence(
          config,
          { mode: 'action', operationValue: 'send' },
          has('to'),
          onCard(config)
        )
      )
    ).toBe('Send an email to ⟨to⟩')
    expect(
      render(
        resolveCanvasSentence(
          config,
          { mode: 'action', operationValue: 'search' },
          has('query'),
          onCard(config)
        )
      )
    ).toBe('Search email for ⟨query⟩')
  })

  it('falls back to the default sentence when the operation has none', () => {
    const config = createConfig(
      {
        default: [{ text: 'Run', field: 'code', core: true }],
        byOperation: { special: [{ text: 'Do the special thing with', field: 'x', core: true }] },
      },
      ['operation', 'code', 'x']
    )

    expect(
      render(
        resolveCanvasSentence(
          config,
          { mode: 'action', operationValue: 'unmapped' },
          has('code'),
          onCard(config)
        )
      )
    ).toBe('Run ⟨code⟩')
  })

  it('paints the trigger sentence, not the action one, when the card is a trigger', () => {
    /* A dual-mode block's operation dropdown still holds its action default, so
       reusing the action sentence would narrate a call the block will not make. */
    const config = createConfig(
      { byOperation: { send: [{ text: 'Post', field: 'message', core: true }] } },
      ['operation', { id: 'message', type: 'short-input', title: 'Message' }]
    )
    const withTrigger = {
      ...config,
      canvasPresentation: {
        ...config.canvasPresentation,
        triggerSentences: { default: ['Run when a message arrives'] },
      },
    } as TestConfig

    expect(
      render(
        resolveCanvasSentence(
          withTrigger,
          { mode: 'trigger', triggerId: null, triggerName: null },
          has('message'),
          onCard(withTrigger)
        )
      )
    ).toBe('Run when a message arrives')
  })
})

describe('estimateSentenceLines', () => {
  it('measures an empty core slot by its noun, which is what the card paints there', () => {
    /*
     * Both real callers read values through `getDisplayValue`, which reports an
     * unset field as the `-` sentinel — NOT an empty string. An earlier version
     * of this test passed `() => ''`, an input no caller produces, and so proved
     * the opposite of production: the noun branch never ran and 1,701 sentences
     * were measured a line short, overlapping cards during auto-layout.
     */
    const unsetValue = () => getDisplayValue(undefined)
    expect(unsetValue()).toBe('-')

    const withNoun = estimateSentenceLines(
      [{ subBlockId: 'channel', noun: 'a rather long placeholder noun' }],
      unsetValue,
      120
    )
    const withoutNoun = estimateSentenceLines([{ subBlockId: 'channel' }], unsetValue, 120)
    expect(withNoun).toBeGreaterThan(withoutNoun)
  })
})
