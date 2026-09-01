/**
 * @vitest-environment node
 *
 * Unit coverage for the invariants. The fleet-wide run lives in
 * `scripts/check-canvas-sentences.ts` — loading all 315 block configs here
 * would drag the whole registry into every test run.
 */
import { describe, expect, it } from 'vitest'
import {
  type ValidatableBlockConfig,
  validateBlockSentences,
} from '@/lib/workflows/blocks/canvas-sentence-validation'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

type SentenceSpec = NonNullable<NonNullable<BlockConfig['canvasPresentation']>['sentences']>

function createConfig(
  sentences: SentenceSpec,
  subBlocks: Array<Partial<SubBlockConfig> & { id: string }>
): ValidatableBlockConfig {
  return {
    type: 'test-block',
    canvasPresentation: { defaultTitle: 'Test', sentences },
    subBlocks: subBlocks.map((subBlock) => ({ type: 'short-input', ...subBlock })),
  } as ValidatableBlockConfig
}

/** An operation dropdown with the given option ids. */
function operationDropdown(...ids: string[]): Partial<SubBlockConfig> & { id: string } {
  return {
    id: 'operation',
    type: 'dropdown',
    options: ids.map((id) => ({ label: id, id })),
  }
}

const messages = (config: ValidatableBlockConfig): string[] =>
  validateBlockSentences(config).failures.map((failure) => failure.message)

describe('field references', () => {
  /* Each fixture opens on literal copy so the sentence is guaranteed to render
     and only the rule under test can fail. */
  it('rejects a field id the block does not declare', () => {
    const config = createConfig({ default: ['Run', { text: 'with', field: 'nope' }] }, [
      { id: 'code' },
    ])

    expect(messages(config)).toEqual([
      expect.stringContaining('references "nope", which is not a subblock'),
    ])
  })

  it('accepts a field the block declares', () => {
    const config = createConfig({ default: [{ text: 'Run', field: 'code', core: true }] }, [
      { id: 'code' },
    ])

    expect(messages(config)).toEqual([])
  })

  it('rejects an empty field list', () => {
    const config = createConfig({ default: ['Run', { text: 'with', field: [] }] }, [{ id: 'code' }])

    expect(messages(config)).toEqual([expect.stringContaining('empty `field`')])
  })
})

describe('byOperation keys', () => {
  it('rejects a key with no matching dropdown option', () => {
    const config = createConfig({ byOperation: { snd: [{ field: 'to', core: true }] } }, [
      operationDropdown('send', 'search'),
      { id: 'to' },
    ])

    expect(messages(config)).toEqual([
      expect.stringContaining('no option with id "snd" on the "operation" dropdown'),
    ])
  })

  it('accepts a key that matches an option', () => {
    const config = createConfig({ byOperation: { send: [{ field: 'to', core: true }] } }, [
      operationDropdown('send', 'search'),
      { id: 'to' },
    ])

    expect(messages(config)).toEqual([])
  })
})

describe('canonical-pair completeness', () => {
  /*
   * The failure this prevents is silent: an advanced-mode user has only the
   * advanced member filled, so a clause naming just the basic one resolves to
   * nothing and the card drops to field rows for half the fleet's users.
   */
  const pairSubBlocks = [
    { id: 'tableSelector', canonicalParamId: 'tableId', mode: 'basic' as const },
    { id: 'manualTableId', canonicalParamId: 'tableId', mode: 'advanced' as const },
  ]

  it('rejects a clause naming only the basic member', () => {
    const config = createConfig(
      { default: [{ text: 'Query', field: 'tableSelector', core: true }] },
      pairSubBlocks
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('omits "manualTableId" from canonical group "tableId"'),
    ])
  })

  it('rejects a clause naming only the advanced member', () => {
    /* Non-core plus literal copy, so only the canonical-pair rule can fire —
       the advanced member is also, correctly, not on a basic-mode card. */
    const config = createConfig(
      { default: ['Query rows', { text: 'from', field: 'manualTableId' }] },
      pairSubBlocks
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('omits "tableSelector" from canonical group "tableId"'),
    ])
  })

  it('rejects a core clause naming only the advanced member, which a basic card hides', () => {
    const config = createConfig(
      { default: [{ text: 'Query', field: 'manualTableId', core: true }] },
      pairSubBlocks
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('omits "tableSelector" from canonical group "tableId"'),
      expect.stringContaining('is `core`, but "manualTableId" is not proven to be on the card'),
      expect.stringContaining('nothing in this sentence is guaranteed to render'),
    ])
  })

  it('accepts a clause naming both members', () => {
    const config = createConfig(
      {
        default: [{ text: 'Query', field: ['tableSelector', 'manualTableId'], core: true }],
      },
      pairSubBlocks
    )

    expect(messages(config)).toEqual([])
  })
})

describe('dead clauses', () => {
  it('rejects a field gated to a different operation', () => {
    const config = createConfig(
      {
        byOperation: {
          send: ['Send', { text: 'to', field: 'query' }],
        },
      },
      [
        operationDropdown('send', 'search'),
        { id: 'query', condition: { field: 'operation', value: 'search' } },
      ]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('never visible for operation "send"'),
    ])
  })

  it('honours a negated condition', () => {
    const config = createConfig(
      { byOperation: { send: [{ text: 'Send to', field: 'to', core: true }] } },
      [
        operationDropdown('send', 'search'),
        { id: 'to', condition: { field: 'operation', value: 'search', not: true } },
      ]
    )

    expect(messages(config)).toEqual([])
  })

  it('accepts when one of several same-id definitions matches', () => {
    /* table declares `filter` once per operation family; the card shows whichever matches. */
    const config = createConfig(
      { byOperation: { bulk: [{ text: 'Update, where', field: 'filter', core: true }] } },
      [
        operationDropdown('query', 'bulk'),
        { id: 'filter', condition: { field: 'operation', value: 'query' } },
        { id: 'filter', condition: { field: 'operation', value: 'bulk' } },
      ]
    )

    expect(messages(config)).toEqual([])
  })

  it('ignores an unconditioned trigger-mode redeclaration of the same id', () => {
    /*
     * A dual-mode block spreads its trigger's subblocks after its own, and those
     * re-declare ids with `mode: 'trigger'` and no condition. Counting them as
     * visible would mask a dead clause on every action-mode operation.
     */
    const config = createConfig(
      {
        byOperation: {
          list: ['List rows', { text: 'in', field: 'tableId' }],
        },
      },
      [
        operationDropdown('list', 'insert'),
        { id: 'tableId', condition: { field: 'operation', value: 'insert' } },
        { id: 'tableId', mode: 'trigger' },
      ]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('never visible for operation "list"'),
    ])
  })

  it('resolves a function-valued condition rather than giving up on it', () => {
    /* The card just calls the function (`evaluateSubBlockCondition`), so calling
       it here with the operation under test is what keeps the two in agreement.
       Before this, every function-gated field was silently assumed reachable. */
    const config = createConfig(
      {
        byOperation: {
          send: ['Send', { text: 'to', field: 'to' }],
        },
      },
      [
        operationDropdown('send'),
        { id: 'to', condition: () => ({ field: 'operation', value: 'search' }) },
      ]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('never visible for operation "send"'),
    ])
  })

  it('stays silent when the resolved condition turns on a value the user supplies', () => {
    /* `mode` is not the operation, so whether the field shows is not decidable
       here — the clause is left alone rather than wrongly called dead. */
    const config = createConfig(
      {
        byOperation: {
          send: ['Send', { text: 'to', field: 'to' }],
        },
      },
      [
        operationDropdown('send'),
        { id: 'to', condition: () => ({ field: 'mode', value: 'direct' }) },
      ]
    )

    expect(messages(config)).toEqual([])
  })
})

describe('operations must be distinguishable', () => {
  /*
   * The copy-paste failure at scale: a block with dozens of similar read
   * endpoints gets one clause duplicated and never adjusted, so two operations
   * paint the same card and the user cannot tell which is running.
   */
  it('rejects two operations that render identically', () => {
    const config = createConfig(
      {
        byOperation: {
          get_thread: [{ text: 'Read thread', field: 'threadId', core: true }],
          get_thread_replies: [{ text: 'Read thread', field: 'threadId', core: true }],
        },
      },
      [operationDropdown('get_thread', 'get_thread_replies'), { id: 'threadId' }]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('renders identically to "get_thread_replies"'),
    ])
  })

  it('accepts operations that differ only in copy', () => {
    const config = createConfig(
      {
        byOperation: {
          get_thread: [{ text: 'Read thread', field: 'threadId', core: true }],
          get_thread_replies: [
            { text: 'Read every reply in thread', field: 'threadId', core: true },
          ],
        },
      },
      [operationDropdown('get_thread', 'get_thread_replies'), { id: 'threadId' }]
    )

    expect(messages(config)).toEqual([])
  })

  /*
   * The pair that the whole-declaration check could never see: the clause that
   * tells them apart is the one that is empty on an untouched card, which is
   * exactly when the user is still working out what the block does.
   */
  it('rejects two operations that differ only in a clause that can drop', () => {
    const config = createConfig(
      {
        byOperation: {
          tag_contact: [
            { text: 'Add tag', field: 'tagId', core: true },
            { text: 'to contact', field: 'contactId' },
          ],
          tag_conversation: [
            { text: 'Add tag', field: 'tagId', core: true },
            { text: 'to conversation', field: 'conversationId' },
          ],
        },
      },
      [
        operationDropdown('tag_contact', 'tag_conversation'),
        { id: 'tagId' },
        { id: 'contactId' },
        { id: 'conversationId' },
      ]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('renders identically to "tag_conversation" once optional clauses'),
    ])
  })

  it('accepts the same pair once each names its target in a core clause', () => {
    const config = createConfig(
      {
        byOperation: {
          tag_contact: [
            { text: 'Add tag', field: 'tagId', core: true },
            { text: 'to contact', field: 'contactId', core: true },
          ],
          tag_conversation: [
            { text: 'Add tag', field: 'tagId', core: true },
            { text: 'to conversation', field: 'conversationId', core: true },
          ],
        },
      },
      [
        operationDropdown('tag_contact', 'tag_conversation'),
        { id: 'tagId' },
        { id: 'contactId' },
        { id: 'conversationId' },
      ]
    )

    expect(messages(config)).toEqual([])
  })

  it('reports a pair identical in both readings only once', () => {
    const config = createConfig(
      {
        byOperation: {
          get_thread: [{ text: 'Read thread', field: 'threadId', core: true }],
          get_thread_replies: [{ text: 'Read thread', field: 'threadId', core: true }],
        },
      },
      [operationDropdown('get_thread', 'get_thread_replies'), { id: 'threadId' }]
    )

    expect(messages(config)).toHaveLength(1)
  })
})

describe('article agreement with a dropdown chip', () => {
  /*
   * A chip renders the dropdown's label, so an article in front of it is
   * agreeing with a value the author never sees. The label set is enumerable,
   * so the disagreement is decidable here.
   */
  const campaignTypes = {
    id: 'campaignType',
    type: 'dropdown' as const,
    options: [
      { id: 'regular', label: 'Regular' },
      { id: 'ab', label: 'A/B Split' },
    ],
  }

  it('rejects an article in front of a core chip, which supplies its own', () => {
    /* A core chip stands the field's noun in for the missing value, and a noun
       carries its own article — so the card would read "Create a a campaign
       type". This applies whatever the labels are; nothing to enumerate. */
    const config = createConfig(
      { default: [{ text: 'Create a', field: 'campaignType', after: 'campaign', core: true }] },
      [campaignTypes]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('is core and supplies its own article'),
    ])
  })

  it('accepts a core chip with no article in front of it', () => {
    const config = createConfig(
      { default: [{ text: 'Create', field: 'campaignType', after: 'campaign', core: true }] },
      [campaignTypes]
    )

    expect(messages(config)).toEqual([])
  })

  it('rejects "a" in front of an optional label that needs "an"', () => {
    /* An optional chip only ever renders a real label, so the article can be
       checked against the label set instead. */
    const config = createConfig(
      { default: ['Create', { text: 'a', field: 'campaignType', after: 'campaign' }] },
      [campaignTypes]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('puts "a" in front of the "campaignType" chip'),
    ])
  })

  it('accepts the value moved out from behind the article', () => {
    const config = createConfig(
      { default: ['Create a campaign', { text: 'of type', field: 'campaignType' }] },
      [campaignTypes]
    )

    expect(messages(config)).toEqual([])
  })

  it('honours labels whose spelling and pronunciation disagree', () => {
    /* "a user", "a one-time budget" — vowel letters, consonant sounds. */
    const config = createConfig(
      { default: ['Create', { text: 'a', field: 'kind', after: 'record' }] },
      [
        {
          id: 'kind',
          type: 'dropdown',
          options: [
            { id: 'user', label: 'User' },
            { id: 'once', label: 'One-time' },
          ],
        },
      ]
    )

    expect(messages(config)).toEqual([])
  })

  it('reads an initialism letter by letter', () => {
    const config = createConfig(
      { default: ['Send', { text: 'a', field: 'channel', after: 'message' }] },
      [{ id: 'channel', type: 'dropdown', options: [{ id: 'sms', label: 'SMS' }] }]
    )

    expect(messages(config)).toEqual([expect.stringContaining('needs "an"')])
  })

  it('does not treat an all-caps word as an initialism', () => {
    /* `MERGE` and `HEAD` are HTTP verbs read as words — "a MERGE request". */
    const config = createConfig(
      { default: ['Send', { text: 'a', field: 'method', after: 'request' }] },
      [
        {
          id: 'method',
          type: 'dropdown',
          options: [
            { id: 'merge', label: 'MERGE' },
            { id: 'head', label: 'HEAD' },
          ],
        },
      ]
    )

    expect(messages(config)).toEqual([])
  })

  it('stays silent when the chip is not an enumerable dropdown', () => {
    const config = createConfig(
      { default: ['Create', { text: 'a', field: 'name', after: 'record' }] },
      [{ id: 'name' }]
    )

    expect(messages(config)).toEqual([])
  })
})

describe('correlative constructions', () => {
  /*
   * The opener sits in the clause's own `text`, in front of its own chip, so
   * nothing trails and `DANGLING_CONNECTIVES` cannot see it. What breaks is the
   * relation: "Route from ⟨origin⟩" is well-formed and describes a different
   * journey than the one the block runs.
   */
  it('rejects a droppable second operand after "from"', () => {
    const config = createConfig(
      {
        default: [
          { text: 'Route from', field: 'origin', core: true },
          { text: 'to', field: 'destination' },
        ],
      },
      [{ id: 'origin' }, { id: 'destination' }]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('clause 0 opens "from … to", but clause 1 carries the other half'),
    ])
  })

  it('rejects a droppable second operand after "between"', () => {
    const config = createConfig(
      {
        default: [
          { text: 'Compare builds between', field: 'fromBuild', core: true },
          { text: 'and', field: 'toBuild' },
        ],
      },
      [{ id: 'fromBuild' }, { id: 'toBuild' }]
    )

    expect(messages(config)).toEqual([expect.stringContaining('opens "between … and"')])
  })

  it('accepts a second operand that names itself when empty', () => {
    const config = createConfig(
      {
        default: [
          { text: 'Route from', field: 'origin', core: true },
          { text: 'to', field: 'destination', core: true },
        ],
      },
      [{ id: 'origin' }, { id: 'destination' }]
    )

    expect(messages(config)).toEqual([])
  })

  it('ignores "from" with no matching closer', () => {
    /* "List rows from ⟨table⟩" is a complete thought, not half a relation. */
    const config = createConfig(
      {
        default: [
          { text: 'List rows from', field: 'table', core: true },
          { text: ', limited to', field: 'limit' },
        ],
      },
      [{ id: 'table' }, { id: 'limit' }]
    )

    expect(messages(config)).toEqual([])
  })
})

describe('core clauses', () => {
  /* The old DSL allowed one anchor per sentence, because the anchor suppressed
     the whole sentence when it failed. A core clause only holds its own slot, so
     a sentence may have as many as it needs to read whole. */
  it('accepts several core clauses in one sentence', () => {
    const config = createConfig(
      {
        default: [
          { text: 'Send', field: 'to', core: true },
          { text: 'about', field: 'subject', core: true },
        ],
      },
      [{ id: 'to' }, { id: 'subject' }]
    )

    expect(messages(config)).toEqual([])
  })

  it('rejects a core clause whose field this operation never shows', () => {
    /* `core` promises the clause always renders; there is no replacement copy in
       this DSL, so a clause gated away simply drops and the promise was false. */
    const config = createConfig(
      { byOperation: { send: ['Send', { text: 'to', field: 'query', core: true }] } },
      [
        operationDropdown('send', 'search'),
        { id: 'query', condition: { field: 'operation', value: 'search' } },
      ]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('never visible for operation "send"'),
      expect.stringContaining('is `core`, but "query" is not proven to be on the card'),
    ])
  })
})

describe('every sentence keeps a clause', () => {
  /*
   * There is no path back to field rows, so a sentence that can resolve to
   * nothing would paint an empty card. These are the shapes that guarantee it
   * cannot — and the one that does not.
   */
  it('rejects a sentence whose only clause can vanish', () => {
    const config = createConfig({ default: [{ text: 'Send to', field: 'to' }] }, [{ id: 'to' }])

    expect(messages(config)).toEqual([
      expect.stringContaining('nothing in this sentence is guaranteed to render'),
    ])
  })

  it('rejects an anchor whose condition turns on a value the user supplies', () => {
    /* `mode` is not the operation and not an enumerable partition, so nothing
       here proves the field is on the card. */
    const config = createConfig(
      { byOperation: { send: [{ text: 'Send to', field: 'to', core: true }] } },
      [operationDropdown('send'), { id: 'to', condition: () => ({ field: 'mode', value: 'a' }) }]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('is `core`, but "to" is not proven to be on the card'),
      expect.stringContaining('nothing in this sentence is guaranteed to render'),
    ])
  })

  it("rejects an anchor whose gate names a dropdown, rather than guessing that dropdown's value", () => {
    /*
     * An earlier version assumed a gate field this operation does not display
     * still holds its declared default. Subblock values persist across operation
     * switches, so that was false: picking DM under Slack's `send`, then
     * switching to `get_channel_info`, left `destinationType: 'dm'` set and hid
     * the channel field the checker had just proven visible. The fix belongs in
     * the block — scope the gate to the operations that offer the switch — so
     * this stays undecidable here rather than being guessed.
     */
    const config = createConfig(
      { byOperation: { read: [{ text: 'Read from', field: 'channel', core: true }] } },
      [
        operationDropdown('send', 'read'),
        {
          id: 'destinationType',
          type: 'dropdown',
          value: () => 'channel',
          condition: { field: 'operation', value: 'send' },
          options: [{ id: 'channel' }, { id: 'dm' }],
        },
        { id: 'channel', condition: { field: 'destinationType', value: 'dm', not: true } },
      ]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('is `core`, but "channel" is not proven to be on the card'),
      expect.stringContaining('nothing in this sentence is guaranteed to render'),
    ])
  })

  it('accepts fields whose conditions exhaustively partition one dropdown', () => {
    /* `file` names both members of an upload/url pair, so exactly one shows. */
    const config = createConfig(
      { default: [{ text: 'Read', field: ['upload', 'url'], core: true }] },
      [
        { id: 'inputMethod', type: 'dropdown', options: [{ id: 'upload' }, { id: 'url' }] },
        { id: 'upload', condition: { field: 'inputMethod', value: 'upload' } },
        { id: 'url', condition: { field: 'inputMethod', value: 'url' } },
      ]
    )

    expect(messages(config)).toEqual([])
  })

  it('rejects a partition that leaves an option uncovered', () => {
    const config = createConfig({ default: [{ text: 'Read', field: ['upload'], core: true }] }, [
      { id: 'inputMethod', type: 'dropdown', options: [{ id: 'upload' }, { id: 'url' }] },
      { id: 'upload', condition: { field: 'inputMethod', value: 'upload' } },
    ])

    expect(messages(config)).toEqual([
      expect.stringContaining('is `core`, but "upload" is not proven to be on the card'),
      expect.stringContaining('nothing in this sentence is guaranteed to render'),
    ])
  })
})

describe('connective hygiene', () => {
  it('rejects an `after` connective in front of an optional clause', () => {
    /* Renders "Query ⟨orders⟩, where" when the filter is unset. */
    const config = createConfig(
      {
        default: [
          { text: 'Query', field: 'table', after: ', where', core: true },
          { field: 'filter' },
        ],
      },
      [{ id: 'table' }, { id: 'filter' }]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('ends on "where", but clause 1 is optional'),
    ])
  })

  it('accepts the same connective carried inside the optional clause', () => {
    const config = createConfig(
      {
        default: [
          { text: 'Query', field: 'table', core: true },
          { text: ', where', field: 'filter' },
        ],
      },
      [{ id: 'table' }, { id: 'filter' }]
    )

    expect(messages(config)).toEqual([])
  })

  it('rejects an `after` connective in front of an optional clause, core or not', () => {
    /* A core clause's own `after` is just as exposed: the clause renders its
       noun and the connective with it, and the next clause still drops. */
    const config = createConfig(
      {
        default: [
          { text: 'Send', field: 'method', after: 'request to', core: true },
          { field: 'url' },
        ],
      },
      [{ id: 'method' }, { id: 'url' }]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('ends on "to", but clause 1 is optional'),
    ])
  })

  it('rejects a trailing connective with nothing after it', () => {
    const config = createConfig(
      { default: [{ text: 'Query', field: 'table', after: 'where', core: true }] },
      [{ id: 'table' }]
    )

    expect(messages(config)).toEqual([
      expect.stringContaining('ends on "where" with nothing after it'),
    ])
  })

  it('accepts a connective in front of a clause that always renders', () => {
    const config = createConfig(
      {
        default: [
          { text: 'Send', field: 'method', after: 'request to', core: true },
          { field: 'url', core: true },
        ],
      },
      [{ id: 'method' }, { id: 'url' }]
    )

    expect(messages(config)).toEqual([])
  })
})

describe('coverage', () => {
  it('counts a block with no operation dropdown as one slot', () => {
    const withSentence = createConfig({ default: [{ field: 'code', core: true }] }, [
      { id: 'code' },
    ])
    const without = createConfig({}, [{ id: 'code' }])

    expect(validateBlockSentences(withSentence).coverage).toEqual({
      covered: 1,
      total: 1,
      missing: [],
    })
    expect(validateBlockSentences(without).coverage).toEqual({
      covered: 0,
      total: 1,
      missing: ['default'],
    })
  })

  it('reports the operations still missing a sentence', () => {
    const config = createConfig({ byOperation: { send: [{ field: 'to', core: true }] } }, [
      operationDropdown('send', 'search', 'archive'),
      { id: 'to' },
    ])

    expect(validateBlockSentences(config).coverage).toEqual({
      covered: 1,
      total: 3,
      missing: ['search', 'archive'],
    })
  })

  it('treats a default sentence as covering every operation', () => {
    const config = createConfig({ default: [{ text: 'Act on', field: 'to', core: true }] }, [
      operationDropdown('send', 'search'),
      { id: 'to' },
    ])

    expect(validateBlockSentences(config).coverage).toEqual({
      covered: 2,
      total: 2,
      missing: [],
    })
  })
})
