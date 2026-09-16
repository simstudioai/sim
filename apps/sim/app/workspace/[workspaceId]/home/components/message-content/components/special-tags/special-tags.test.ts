/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * `@/lib/auth/auth-client` builds a Better Auth client at module scope, which
 * throws when NEXT_PUBLIC_APP_URL is absent from the environment (and under
 * `isolate: false` an earlier file may have imported the graph in a polluted
 * env). These tests only exercise pure parsing/model helpers, so stub the
 * client module out entirely.
 */
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}))

import { scalingRatioOver4x } from '@/app/workspace/[workspaceId]/home/components/message-content/components/scaling-test-helpers'
import type {
  ContentSegment,
  CredentialItemData,
  IndexOfCache,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import {
  credentialTagHasVisibleCard,
  formatCredentialSubmissionMessage,
  memoizedIndexOf,
  parseCredentialSubmissionMessage,
  parseCredentialSubmissionProgress,
  parseCredentialTagBody,
  parseLastCredentialTag,
  parseQuestionTagBody,
  parseSpecialTags,
  SPECIAL_TAG_NAMES,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

/**
 * What a reader actually sees: the renderer concatenates adjacent text segments
 * into one markdown string, so how a span is split across segments is not
 * observable. Assert on this rather than on segment-array shape.
 */
function renderedText(segments: ContentSegment[]): string {
  return segments.map((segment) => ('content' in segment ? segment.content : '')).join('')
}

describe('parseCredentialTagBody', () => {
  const secret: CredentialItemData = { type: 'secret_input', name: 'OPENAI_API_KEY' }
  const oauth: CredentialItemData = {
    type: 'link',
    provider: 'google-email',
    value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
  }

  it('normalizes a singleton credential object to one row', () => {
    expect(parseCredentialTagBody(JSON.stringify(secret))).toEqual([secret])
  })

  it('parses provider-only Assistant connection tags while Build still requires a URL', () => {
    const data: CredentialItemData[] = [{ type: 'link', provider: 'slack' }]
    expect(
      parseLastCredentialTag('<credential>{"type":"link","provider":"slack"}</credential>')
    ).toEqual(data)
    expect(credentialTagHasVisibleCard(data, true, 'assistant')).toBe(true)
    expect(credentialTagHasVisibleCard(data, true, 'agent')).toBe(false)
    expect(parseCredentialTagBody('{"type":"link","provider":" "}')).toBeNull()
    expect(parseCredentialTagBody('{"type":"link","provider":"slack","value":123}')).toBeNull()
  })

  it('preserves a mixed credential-input batch in one tag', () => {
    expect(parseCredentialTagBody(JSON.stringify([secret, oauth]))).toEqual([secret, oauth])
  })

  it('rejects empty arrays and batches containing an invalid row', () => {
    expect(parseCredentialTagBody('[]')).toBeNull()
    expect(parseCredentialTagBody(JSON.stringify([secret, { type: 'link' }]))).toBeNull()
  })

  it('formats and strictly pairs the safe continuation without secret values', () => {
    const data = [oauth, secret]
    const message = formatCredentialSubmissionMessage(data)

    expect(message).toBe(
      'Credential setup submitted — {"integrations":[{"name":"google-email","status":"connected"}],"secrets":[{"name":"OPENAI_API_KEY","status":"saved"}]}'
    )
    expect(parseCredentialSubmissionMessage(data, message)).toBe(true)
    expect(parseCredentialSubmissionProgress(data, message)).toEqual({
      integrations: [{ name: 'google-email', status: 'connected' }],
      secrets: [{ name: 'OPENAI_API_KEY', status: 'saved' }],
    })
    expect(parseCredentialSubmissionMessage(data, `${message}!`)).toBe(false)
  })

  it('reports skipped rows without leaking secret values', () => {
    const data = [oauth, secret]
    const message = formatCredentialSubmissionMessage(data, {
      connectedIntegrationIndexes: new Set(),
      savedSecretIndexes: new Set(),
    })

    expect(message).toBe(
      'Credential setup submitted — {"integrations":[{"name":"google-email","status":"skipped"}],"secrets":[{"name":"OPENAI_API_KEY","status":"skipped"}]}'
    )
    expect(parseCredentialSubmissionMessage(data, message)).toBe(true)
  })

  it('still pairs legacy completed setup messages after reload', () => {
    expect(
      parseCredentialSubmissionMessage(
        [oauth, secret],
        'Credential setup complete — integrations: google-email; secrets: OPENAI_API_KEY'
      )
    ).toBe(true)
  })

  it('extracts the last complete credential batch for transcript pairing', () => {
    const content = `First <credential>${JSON.stringify(secret)}</credential> then <credential>${JSON.stringify([oauth, secret])}</credential>`
    expect(parseLastCredentialTag(content)).toEqual([oauth, secret])
  })

  it('only reserves message actions when a credential card is visible to this member', () => {
    const workspaceSecret: CredentialItemData = {
      type: 'secret_input',
      name: 'WORKSPACE_KEY',
      scope: 'workspace',
    }
    const personalSecret: CredentialItemData = {
      type: 'secret_input',
      name: 'PERSONAL_KEY',
      scope: 'personal',
    }

    expect(credentialTagHasVisibleCard([workspaceSecret], false)).toBe(false)
    expect(credentialTagHasVisibleCard([personalSecret], false)).toBe(true)
    expect(credentialTagHasVisibleCard([oauth], false)).toBe(false)
    expect(credentialTagHasVisibleCard([oauth], true)).toBe(true)
  })

  it('offers personal integration connections to Assistant readers without trusting a model URL', () => {
    expect(
      credentialTagHasVisibleCard([{ type: 'link', provider: 'slack' }], false, 'assistant')
    ).toBe(true)
    expect(
      credentialTagHasVisibleCard([{ type: 'link', provider: 'gitlab' }], false, 'assistant')
    ).toBe(false)
  })

  it.each(['secret_input', 'service_account', 'sim_key'] as const)(
    'hides %s setup in Assistant even for a workspace editor',
    (type) => {
      expect(
        credentialTagHasVisibleCard(
          [{ type, name: 'Secret', provider: 'slack' }],
          true,
          'assistant'
        )
      ).toBe(false)
    }
  )
})

/**
 * What the reader can actually see. Mirrors chat-content.tsx: adjacent text
 * segments concatenate, a `thinking` segment renders NOTHING, and every other
 * segment is a card. Distinct from {@link renderedText}, which counts a thinking
 * body as text — using that here would hide a tag whose close swallows content
 * the stream had already put on screen.
 */
function visibleView(segments: ContentSegment[]) {
  return {
    text: segments
      .map((segment) =>
        segment.type === 'thinking' ? '' : 'content' in segment ? segment.content : ' CARD'
      )
      .join(''),
    cardCount: segments.filter((segment) => segment.type !== 'text' && segment.type !== 'thinking')
      .length,
  }
}

/**
 * Replays `content` the way it streams — one growing prefix per frame — and
 * returns what the reader would see on each. A parser bug that only shows up
 * between frames (a card that renders and then un-renders, text that appears and
 * then vanishes) is invisible to a single end-state assertion.
 */
function replayFrames(content: string, step = 1) {
  const frames: ReturnType<typeof visibleView>[] = []
  for (let end = 1; end <= content.length; end += step) {
    frames.push(visibleView(parseSpecialTags(content.slice(0, end), true).segments))
  }
  frames.push(visibleView(parseSpecialTags(content, false).segments))
  return frames
}

const SINGLE_SELECT = {
  type: 'single_select',
  prompt: 'How should I handle the duplicate emails?',
  options: [
    { id: 'keep_newest', label: 'Keep the newest entry' },
    { id: 'merge', label: 'Merge fields into one row' },
  ],
}

const YES_NO = {
  type: 'single_select',
  prompt: 'Delete 4 archived workflows?',
  options: [
    { id: 'yes', label: 'Delete them' },
    { id: 'no', label: 'Cancel' },
  ],
}

const MULTI_SELECT = {
  type: 'multi_select',
  prompt: 'Which channels should the report go to?',
  options: [
    { id: 'slack', label: 'Slack' },
    { id: 'email', label: 'Email' },
    { id: 'sheet', label: 'Google Sheet' },
  ],
}

describe('parseQuestionTagBody', () => {
  it('normalizes a single object body to a one-element array', () => {
    expect(parseQuestionTagBody(JSON.stringify(SINGLE_SELECT))).toEqual([SINGLE_SELECT])
  })

  it('preserves array order for multi-step bodies', () => {
    const parsed = parseQuestionTagBody(JSON.stringify([SINGLE_SELECT, YES_NO, MULTI_SELECT]))
    expect(parsed).toEqual([SINGLE_SELECT, YES_NO, MULTI_SELECT])
  })

  it('accepts multi_select questions', () => {
    expect(parseQuestionTagBody(JSON.stringify(MULTI_SELECT))).toEqual([MULTI_SELECT])
  })

  it('rejects single_select without options', () => {
    expect(parseQuestionTagBody(JSON.stringify({ type: 'single_select', prompt: 'Pick' }))).toBe(
      null
    )
  })

  it('rejects empty options', () => {
    expect(
      parseQuestionTagBody(JSON.stringify({ type: 'single_select', prompt: 'Sure?', options: [] }))
    ).toBe(null)
  })

  it('rejects the removed text and confirm types', () => {
    expect(parseQuestionTagBody(JSON.stringify({ type: 'text', prompt: 'What time zone?' }))).toBe(
      null
    )
    expect(parseQuestionTagBody(JSON.stringify({ ...YES_NO, type: 'confirm' }))).toBe(null)
  })

  it('strips agent-supplied catch-all options (the card provides its own)', () => {
    const withOther = {
      ...SINGLE_SELECT,
      options: [...SINGLE_SELECT.options, { id: 'other', label: 'Something else' }],
    }
    expect(parseQuestionTagBody(JSON.stringify(withOther))).toEqual([SINGLE_SELECT])
  })

  it('rejects a question whose every option is a catch-all', () => {
    const onlyOther = {
      type: 'single_select',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'Other' },
        { id: 'b', label: 'None of the above' },
      ],
    }
    expect(parseQuestionTagBody(JSON.stringify(onlyOther))).toBe(null)
  })

  it('rejects an empty prompt', () => {
    expect(parseQuestionTagBody(JSON.stringify({ ...SINGLE_SELECT, prompt: '  ' }))).toBe(null)
  })

  it('rejects a malformed option', () => {
    expect(
      parseQuestionTagBody(JSON.stringify({ ...SINGLE_SELECT, options: [{ id: 'keep_newest' }] }))
    ).toBe(null)
  })

  it('rejects an array containing one invalid question', () => {
    expect(parseQuestionTagBody(JSON.stringify([SINGLE_SELECT, { type: 'single_select' }]))).toBe(
      null
    )
  })

  it('rejects empty arrays and non-JSON bodies', () => {
    expect(parseQuestionTagBody('[]')).toBe(null)
    expect(parseQuestionTagBody('not json')).toBe(null)
  })
})

describe('parseSpecialTags with <question>', () => {
  it('extracts a complete question tag interleaved with text', () => {
    const content = `Before the tag. <question>${JSON.stringify(SINGLE_SELECT)}</question> After the tag.`
    const { segments, hasPendingTag } = parseSpecialTags(content, false)
    expect(hasPendingTag).toBe(false)
    expect(segments).toEqual([
      { type: 'text', content: 'Before the tag. ' },
      { type: 'question', data: [SINGLE_SELECT] },
      { type: 'text', content: ' After the tag.' },
    ])
  })

  it('extracts a multi-step array body as one segment', () => {
    const content = `<question>${JSON.stringify([SINGLE_SELECT, YES_NO, MULTI_SELECT])}</question>`
    const { segments } = parseSpecialTags(content, false)
    expect(segments).toEqual([{ type: 'question', data: [SINGLE_SELECT, YES_NO, MULTI_SELECT] }])
  })

  it('flags an unclosed question tag as pending while streaming', () => {
    const { segments, hasPendingTag } = parseSpecialTags(
      'Thinking about it. <question>[{"type":"single_sel',
      true
    )
    expect(hasPendingTag).toBe(true)
    expect(segments).toEqual([{ type: 'text', content: 'Thinking about it. ' }])
  })

  it('keeps the text when a matched pair fails to parse', () => {
    // Verbatim from a real message (trace b095e080). The model explained the
    // tag and ended with a backticked example containing a REAL closing tag,
    // which closed the earlier opener and made everything between it the body.
    // That body is not valid JSON, so the segment was dropped and the render
    // resumed mid-sentence at ") is what actually produces the interactive
    // chip." — three paragraphs silently gone.
    const raw =
      'Here you go — with the ending tag intentionally malformed as `</workflow_resource>`:\n\n' +
      '<workspace_resource>{"type": "file", "path": "files/notes.md", "title": "notes.md"}</workflow_resource>\n\n' +
      "Since the closing tag doesn't match the opening `<workspace_resource>`, the chat won't " +
      'recognize it as a valid resource chip. A properly matched pair ' +
      '(`<workspace_resource>...</workspace_resource>`) is what actually produces the interactive chip.'

    const rendered = renderedText(parseSpecialTags(raw, false).segments)

    expect(rendered).toContain("Since the closing tag doesn't match")
    expect(rendered).toContain('A properly matched pair')
    expect(rendered).toContain('"path": "files/notes.md"')
    // No segment renders as a resource chip — the body was never valid.
    expect(parseSpecialTags(raw, false).segments.some((s) => s.type === 'workspace_resource')).toBe(
      false
    )
  })

  it('still parses a valid tag that follows a rejected one', () => {
    const { segments } = parseSpecialTags(
      'I use <thinking> loosely here. Anyway: <options>[{"title":"A","description":"d"}]</options> done.',
      false
    )
    expect(segments.map((segment) => segment.type)).toContain('options')
  })

  it('loses nothing when the model writes no closing tag at all', () => {
    // Verbatim from a real message (trace 220cc02d). No close tag exists, so no
    // marker rule can fire — but the JSON value completes and prose follows,
    // which settles it at the first space. Asserted as LOSSLESS: mid-stream and
    // complete, every character survives.
    const raw =
      'The dataset lives in <workspace_resource>{"type": "file", "path": "files/notes.md"} and I keep coming back to it whenever I need a quick reference. It never quite has everything.'
    const streaming = parseSpecialTags(raw, true)
    expect(streaming.hasPendingTag).toBe(false)
    expect(renderedText(streaming.segments)).toBe(raw)
    expect(renderedText(parseSpecialTags(raw, false).segments)).toBe(raw)
  })

  it('does not rescan the interior of a body that carried no markers', () => {
    // Pins WHY a settled span resumes past the CLOSE, never past the opener.
    // Resuming past the opener would rescan the interior, and since the marker
    // scan runs on the blanked body, a tag quoted inside a JSON string is
    // invisible to it and would be re-parsed as a REAL tag on the second pass —
    // painting the quoted JSON verbatim as raw text (its escaped quotes cannot
    // re-parse as a card), the exact failure `discard` exists to prevent. The
    // span itself opens `{"` and will not parse (trailing junk), so it is an
    // attempted payload and is discarded whole; what must never happen is a
    // partial re-parse of its quoted interior.
    const raw =
      'A <question>{"a":"<options>{\\"k\\":{\\"title\\":\\"x\\",\\"description\\":\\"y\\"}}</options>"} junk</question> B'
    const { segments } = parseSpecialTags(raw, false)
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
    expect(renderedText(segments)).toBe('A  B')
  })

  it('keeps prose a tag wrapped instead of a payload', () => {
    // Verbatim from a real message (trace 1206fd8a): a matched pair whose body
    // is plain prose, never an attempted JSON payload. The sentence read
    // "...once I wired up to handle the welcome sequence" with the subject gone.
    const raw =
      'once I wired up <workspace_resource>the gmail-agent workflow</workspace_resource> to handle the welcome sequence.'
    const rendered = renderedText(parseSpecialTags(raw, false).segments)
    expect(rendered).toContain('the gmail-agent workflow')
    expect(rendered).toContain('to handle the welcome sequence')
  })

  it('shows a body that will not parse at all, rather than dropping it', () => {
    // `discard` is only defensible for a payload the agent actually FORMED —
    // valid JSON that failed its shape guard. Bracket depth cannot tell prose
    // wrapped in braces from a real payload, so without an actual parse these
    // were deleted: the first is a resource name someone wrote in braces, the
    // other two are the commonest JSON slips a model makes.
    const cases = [
      'I saved <workspace_resource>{the Q4 report}</workspace_resource> for you.',
      'See <workspace_resource>{type: "file", path: "a.md"}</workspace_resource> ok',
      "See <workspace_resource>{'type':'file'}</workspace_resource> ok",
    ]
    for (const raw of cases) {
      const { segments } = parseSpecialTags(raw, false)
      expect(renderedText(segments)).toBe(raw)
    }
  })

  it('still drops a marker-free malformed payload rather than showing raw JSON', () => {
    // The complement of the case above: no tag markers in the body, so this is
    // a genuinely broken emission from the agent, not swallowed prose.
    const { segments, hasPendingTag } = parseSpecialTags(
      'Before. <question>{"type":"single_select"}</question> After.',
      false
    )
    expect(hasPendingTag).toBe(false)
    // Asserted on the rendered text, not the segment array: how the surviving
    // prose is split across text segments is display-neutral, so pinning the
    // array shape would break on a behavior-preserving change to the split.
    expect(renderedText(segments)).toBe('Before.  After.')
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('drops that same payload even when its JSON quotes tag syntax', () => {
    // The marker scan must blank JSON strings the way the streaming path does.
    // Scanning the raw body sees `</options>` inside the payload, calls the span
    // literal text, and renders the raw JSON — the outcome `discard` exists to
    // prevent.
    //
    // The quoted marker deliberately sits in a field OTHER than `prompt`: a
    // recoverable prompt is surfaced as text before this path is reached, so a
    // fixture carrying one would assert the recovery rather than the blanking
    // this test exists for. Matches the prompt-less body used above.
    const { segments } = parseSpecialTags(
      'A <question>[{"type":"single_select","title":"use </options> here?"}]</question> B',
      false
    )
    expect(renderedText(segments)).toBe('A  B')
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('drops a payload one typo away from valid instead of showing raw JSON', () => {
    // The first three are verbatim from production screenshots (2026-07-31): an
    // extra `}` before the array close, a missing opening quote on a key, and a
    // stray `]}` after the map closes; the fourth adds a trailing comma. Each
    // fails JSON.parse, so the old was-it-ever-JSON test called them prose and
    // rendered the whole payload verbatim — the markdown layer then swallowed
    // the tag markers and the reader saw a wall of raw JSON. They open `{"` or
    // `[{` and carry key-value colons, which marks them as attempted payloads:
    // droppable, like any other broken emission.
    const cases = [
      'Prose before. <question>{"type": "single_select", "prompt": "How should I proceed?", "options": [{"id": "a", "label": "Confirm the id"}}]}</question>',
      'Prose before. <question>{"type":"multi_select","prompt":"What should I build now?",options": [{"id":"lib","label":"Pattern library"}]}</question>',
      'Prose before. <options>{"1": {"title": "Define the criteria", "description": "Populate"}}]}</options>',
      'Prose before. <options>[{"title":"Ship it","description":"Open the PR"},]</options>',
    ]
    for (const raw of cases) {
      const { segments, hasPendingTag } = parseSpecialTags(raw, false)
      expect(hasPendingTag, raw).toBe(false)
      expect(renderedText(segments), raw).toBe('Prose before. ')
      expect(
        segments.every((segment) => segment.type === 'text'),
        raw
      ).toBe(true)
    }
  })

  it('drops a broken inline payload rather than dumping it mid-sentence', () => {
    // Same treatment for the inline tag: a `{"`-opening body with a syntax
    // error reads as an attempted chip, and the sentence survives around the
    // hole exactly as it does for a wrong-shape payload today.
    const raw =
      'I saved <workspace_resource>{"type":"file",path:"a.md"}</workspace_resource> for you.'
    expect(renderedText(parseSpecialTags(raw, false).segments)).toBe('I saved  for you.')
  })

  it('renders nothing for a message that is only an unparsable payload', () => {
    // The discardedTag guard must cover the new class too: with every segment
    // discarded, the raw-content fallback would otherwise resurrect the exact
    // JSON the discard removed.
    const { segments } = parseSpecialTags(
      '<options>{"1": {"title": "a", "description": "b"}}]}</options>',
      false
    )
    expect(segments).toHaveLength(0)
  })

  it('still shows an unparsable body that never opened like a payload', () => {
    // The other side of the attempted-payload line: a bare scalar opens with
    // its own first character, not `{"`/`[{`, so it reads as prose in quotes
    // and must render — same as the brace-wrapped prose cases above.
    const raw = 'see <options>"just a phrase"</options> end'
    expect(renderedText(parseSpecialTags(raw, false).segments)).toBe(raw)
  })

  it('renders brace-wrapped quoted prose — an opener alone is not an attempt', () => {
    // The attempted-payload call takes BOTH kinds of evidence: the `{"` opener
    // and a key-value colon outside string literals. `{"the Q4 report"}` has
    // the opener but no colon — prose in costume, so it renders; a colon
    // inside the quotes changes nothing. The array twin parses as JSON, so it
    // was dropped as `wrong-shape` before this heuristic existed and still is —
    // that verdict comes from a real parse, not from the opener.
    const braceWrapped = 'see <options>{"the Q4 report"}</options> end'
    expect(renderedText(parseSpecialTags(braceWrapped, false).segments)).toBe(braceWrapped)
    const quotedColon = 'see <options>{"ratio: 4:5"}</options> end'
    expect(renderedText(parseSpecialTags(quotedColon, false).segments)).toBe(quotedColon)
    const arrayWrapped = 'see <options>["some list item"]</options> end'
    expect(renderedText(parseSpecialTags(arrayWrapped, false).segments)).toBe('see  end')
  })

  it('discards a broken payload whose strings legitimately mention tag syntax', () => {
    // The prompt quotes a tag name, so a raw scan sees a marker — but the
    // body's quotes are balanced, so the blanked scan already proved the marker
    // sits inside a string. Treating it as a nested tag would render the broken
    // payload as raw JSON, the exact failure `discard` exists to prevent. The
    // raw rescan is reserved for mispaired quotes, where blanked offsets lie.
    const raw =
      'Prose before. <question>{"type": "single_select", "prompt": "Use the <options> tag", "options": [{"id": "a", "label": "x"}}]}</question>'
    const { segments } = parseSpecialTags(raw, false)
    expect(renderedText(segments)).toBe('Prose before. ')
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('does not flash the payload while the closing tag is still arriving', () => {
    // Each frame below is a real mid-stream state: the JSON value has closed, so
    // without tolerating an arriving close the trailing `</opt` reads as stray
    // content and the whole payload is released as text until the final `>`.
    for (const fragment of ['<', '</', '</o', '</opt', '</options']) {
      const { segments, hasPendingTag } = parseSpecialTags(
        `see <options>[{"title":"a","description":"b"}]${fragment}`,
        true
      )
      expect(hasPendingTag).toBe(true)
      expect(renderedText(segments)).toBe('see ')
    }
  })

  it('never flashes a broken payload at any streamed frame', () => {
    // A body that goes non-viable mid-stream (the stray `]}` lands before the
    // close does) used to release as literal text at that frame, then vanish
    // when the close arrived and classified it not-parsable — raw JSON painted
    // on screen only for the close to retract it. Suppression must hold at
    // EVERY frame from the completed opener on, and the settled parse must
    // agree with what the frames showed.
    const raw =
      'Prose before. <options>{"1": {"title": "Define the criteria", "description": "Populate"}}]}</options> after.'
    const bodyStart = raw.indexOf('<options>') + '<options>'.length
    for (let end = bodyStart; end <= raw.length; end++) {
      const { segments } = parseSpecialTags(raw.slice(0, end), true)
      expect(renderedText(segments), `frame ${end}`).not.toContain('{')
    }
    expect(renderedText(parseSpecialTags(raw, false).segments)).toBe('Prose before.  after.')
  })

  it('still rejects a close whose name is wrong rather than merely unfinished', () => {
    // The counterpart to the case above: `</workflow_resource>` can never grow
    // into `</workspace_resource>`, so it settles immediately instead of hiding
    // the rest of the message for the remainder of the stream.
    const raw =
      'see <workspace_resource>{"type":"file","path":"a.md"}</workflow_resource> and then prose.'
    const { hasPendingTag, segments } = parseSpecialTags(raw, true)
    expect(hasPendingTag).toBe(false)
    // Asserted on the text too, not just the flag: a wrong resumeAt keeps the
    // flag correct while dropping the prose, which is the defect class this
    // whole change exists to prevent.
    expect(renderedText(segments)).toBe(raw)
  })

  it('keeps a valid tag whose close an earlier broken tag would borrow', () => {
    // The first opener misspells its close, so it reaches forward and matches
    // the SECOND tag's close, swallowing a perfectly good resource into one
    // literal span. Resuming past the opener re-scans the interior instead.
    const raw =
      'See <workspace_resource>{"type":"file","path":"a.md"}</workflow_resource>\n' +
      'and a real one: <workspace_resource>{"type":"file","path":"b.md","title":"b"}</workspace_resource>'
    const { segments } = parseSpecialTags(raw, false)
    expect(segments.some((s) => s.type === 'workspace_resource')).toBe(true)
    expect(renderedText(segments)).toContain('</workflow_resource>')
  })

  it('finds a nested tag an unbalanced quote hid from the blanked scan', () => {
    // One stray `"` is enough to make blankJsonStringLiterals treat the REST of
    // the body as a string literal, hiding the real `<options>` marker from the
    // scan. The verdict then degrades from `foreign-markers` to `not-viable-json`
    // and resumes past the close, flattening both nested tags into one literal
    // span — so a card already on screen un-renders when the close arrives.
    //
    // Blanking is only meaningful while the body might BE json. Once viability
    // has proved it never was, the raw text is the honest evidence.
    const raw =
      'Saved <workspace_resource>the notes file "notes.md and here is what to do next: ' +
      '<options>[{"title":"Ship it","description":"Open the PR"}]</options>\n' +
      'Full path: <workspace_resource>{"type":"file","path":"files/a.md","title":"a.md"}</workspace_resource>'

    const { segments } = parseSpecialTags(raw, false)
    expect(segments.filter((segment) => segment.type === 'options')).toHaveLength(1)
    expect(segments.filter((segment) => segment.type === 'workspace_resource')).toHaveLength(1)
    // Balancing the quote must reach the same two cards — the quote is the only
    // difference, so this pins that it was never load-bearing for the outcome.
    const balanced = raw.replace('the notes file "notes.md', 'the notes file notes.md')
    const control = parseSpecialTags(balanced, false).segments
    expect(control.filter((segment) => segment.type === 'options')).toHaveLength(1)
    expect(control.filter((segment) => segment.type === 'workspace_resource')).toHaveLength(1)
  })

  it('never un-renders that card as the closing tag arrives', () => {
    // The frame-level face of the case above, and the invariant it broke: the
    // options card is on screen for many frames before the final `>` lands. A
    // card that renders must never revert to raw text.
    const raw =
      'Saved <workspace_resource>the notes file "notes.md and here is what to do next: ' +
      '<options>[{"title":"Ship it","description":"Open the PR"}]</options>\n' +
      'Full path: <workspace_resource>{"type":"file","path":"files/a.md","title":"a.md"}</workspace_resource>'

    let sawCard = false
    for (let end = 1; end <= raw.length; end++) {
      const { segments } = parseSpecialTags(raw.slice(0, end), true)
      const hasCard = segments.some((segment) => segment.type === 'options')
      if (hasCard) sawCard = true
      expect(!sawCard || hasCard, `options card retracted at frame ${end}`).toBe(true)
    }
    expect(sawCard).toBe(true)
    // ...and the settled parse still has it.
    expect(parseSpecialTags(raw, false).segments.some((s) => s.type === 'options')).toBe(true)
  })

  it('does not delete tag syntax quoted inside the body it rescans', () => {
    // The rescan decides on the BLANKED body, so a tag quoted inside a JSON
    // string is invisible to it. Resuming at the opener would re-scan that
    // quoted text raw, re-parse it as a real tag, and drop it — deleting text.
    // Resuming at the MARKER skips the quoted region, so it survives verbatim.
    const inner =
      '<credential>{\\"type\\":\\"link\\",\\"value\\":\\"https://x.example/p\\"}</credential>'
    const raw = `A <question>{"prompt":"${inner}"} </options></question> B`
    const { segments } = parseSpecialTags(raw, false)
    expect(renderedText(segments)).toBe(raw)
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('keeps the blank line between two rejected spans', () => {
    // The renderer concatenates adjacent text segments into one markdown string,
    // so a dropped whitespace-only span silently merges two paragraphs.
    const raw =
      '<workspace_resource>prose one</workspace_resource>\n\n<workspace_resource>prose two</workspace_resource>'
    const { segments } = parseSpecialTags(raw, false)
    expect(renderedText(segments)).toBe(raw)
  })

  it('shows an oversized body it only partly inspected rather than discarding it', () => {
    // Only the first MAX_UNCLOSED_BODY_SCAN characters are scanned. Finding no
    // reason within that window is not evidence the body was a real payload, so
    // the span must be shown — discarding would delete text never examined.
    const body = `{"type":"file","path":"a.md","note":"${'x'.repeat(5000)}`
    const raw = `see <workspace_resource>${body}</workspace_resource> end`
    const { segments } = parseSpecialTags(raw, false)
    expect(renderedText(segments)).toBe(raw)
  })

  it('settles a prose mention at any length, but defers a payload that closes past the window', () => {
    // The scan window's accepted blind spot, pinned so it stays a decision.
    //
    // A mention in prose settles at its FIRST character however long the message
    // runs — prose does not open with `{`, so viability fails immediately.
    const mention = `see <workspace_resource> ${'long prose. '.repeat(600)}`
    expect(parseSpecialTags(mention, true).hasPendingTag).toBe(false)

    // But a JSON body whose top-level value closes BEYOND the window still reads
    // as a viable prefix, so the tail stays hidden until the stream ends. Needs a
    // payload several times larger than any tag emits, and it is lossless once
    // complete — the cost of bounding a scan that otherwise stalls the main
    // thread.
    const oversized = `see <workspace_resource>{"type":"file","note":"${'x'.repeat(5000)}"} and then prose.`
    expect(parseSpecialTags(oversized, true).hasPendingTag).toBe(true)
    expect(renderedText(parseSpecialTags(oversized, false).segments)).toBe(oversized)
  })

  it('still finds a valid tag sitting past the scan window inside a borrowed body', () => {
    // The first opener has no close of its own, so it borrows the inner tag's.
    // Its body is marker-free prose for far longer than the scan window, so the
    // truncated inspection sees only prose and can say nothing about the rest.
    //
    // Resuming past the borrowed close would flatten the inner tag to text purely
    // because of where it fell relative to the window. Resuming at the first
    // uninspected character finds it. Asserted at three lengths so the boundary
    // itself is covered, not just one side of it.
    const inner =
      '<workspace_resource>{"type":"file","path":"files/b.md","title":"b.md"}</workspace_resource>'
    const build = (proseChars: number) =>
      `See <workspace_resource>${'prose word '.repeat(Math.ceil(proseChars / 11))}${inner} end`

    for (const proseChars of [1_000, 6_000, 60_000]) {
      const raw = build(proseChars)
      const { segments } = parseSpecialTags(raw, false)
      expect(segments.filter((segment) => segment.type === 'workspace_resource')).toHaveLength(1)
      // The prose around it survives too — the span is emitted, not skipped.
      expect(renderedText(segments)).toContain('See <workspace_resource>prose word')
      expect(renderedText(segments)).toContain(' end')
    }
  })

  it('still finds a valid tag whose opener STRADDLES the scan-window edge', () => {
    // The window edge is an arbitrary cut, so an opener can begin just before it
    // and finish just after. The test above steps in 11-character units and so
    // lands on only a few offsets; the straddle needs every offset in the band.
    //
    // Resuming exactly at the edge left the opener's `<` behind the cursor, and
    // the opener scan only looks FORWARD — so the tag was never found and its
    // payload rendered as raw JSON text, on a COMPLETED message. Every offset
    // across the band must still produce the card.
    const inner =
      '<workspace_resource>{"type":"file","path":"files/b.md","title":"b.md"}</workspace_resource>'

    for (let filler = 4_060; filler <= 4_110; filler++) {
      const raw = `See <workspace_resource>${'z'.repeat(filler)}${inner} end`
      const { segments } = parseSpecialTags(raw, false)
      expect(
        segments.filter((segment) => segment.type === 'workspace_resource'),
        `filler ${filler}`
      ).toHaveLength(1)
      // Nothing is duplicated or dropped by the rewind either.
      expect(renderedText(segments), `filler ${filler}`).toContain(' end')
    }
  })

  it('still renders a matched pair whose body IS valid', () => {
    const raw =
      'see <workspace_resource>{"type":"file","path":"files/a.md","title":"a.md"}</workspace_resource> ok'
    const { segments } = parseSpecialTags(raw, false)
    expect(segments.some((s) => s.type === 'workspace_resource')).toBe(true)
  })

  it('shows prose immediately mid-stream instead of blanking the rest', () => {
    const content = 'The `<workspace_resource>` chip only renders for a real file.'
    const { segments, hasPendingTag } = parseSpecialTags(content, true)
    expect(hasPendingTag).toBe(false)
    expect(segments.map((s) => ('content' in s ? s.content : s.type)).join('')).toContain(
      'chip only renders for a real file.'
    )
  })

  it('shows text once the JSON value has closed and stray content follows', () => {
    // Verbatim shape from a real message (trace afbeefd0): the close tag was
    // TRUNCATED to `</workspac`, so no marker rule can see it — but the JSON
    // value completes at the `}`, which makes everything after it fatal.
    const raw =
      'kicks off in <workspace_resource>{"type":"file","path":"files/notes.md"}</workspac and after that I brew a cup of coffee.'
    const { segments, hasPendingTag } = parseSpecialTags(raw, true)
    expect(hasPendingTag).toBe(false)
    expect(renderedText(segments)).toContain('I brew a cup of coffee')
  })

  it('tolerates braces inside JSON strings when tracking depth', () => {
    const raw = 'x <workspace_resource>{"title":"a } b","path":"files/a.md"'
    expect(parseSpecialTags(raw, true).hasPendingTag).toBe(true)
  })

  it('does not let an escaped quote end a string early and skew the depth', () => {
    // If `\"` were read as the closing quote, the following `}` would count as a
    // real close, the top-level value would look finished, and the trailing text
    // would settle the tag as unresolvable mid-payload.
    const raw = 'x <workspace_resource>{"title":"a \\" } b","path":"files/a.md"'
    expect(parseSpecialTags(raw, true).hasPendingTag).toBe(true)
  })

  it('still suppresses a JSON-bodied tag that is genuinely mid-stream', () => {
    const { segments, hasPendingTag } = parseSpecialTags(
      'Here you go <workspace_resource>{"type":"file","id":"abc"',
      true
    )
    expect(hasPendingTag).toBe(true)
    expect(segments).toEqual([{ type: 'text', content: 'Here you go ' }])
  })

  it('bails when a foreign closing tag appears inside a prose body', () => {
    // Tags never nest, so a close for a different tag proves the opener was text.
    // Asserted on `thinking` because that is the only tag the nesting rule still
    // serves: a JSON body has no need of it, since a marker outside a string
    // literal is content the viability rule already rejects, and one inside is
    // legitimate quoted syntax that must not count as evidence.
    const raw = 'see <thinking>weighing it </question> more'
    const { hasPendingTag, segments } = parseSpecialTags(raw, true)
    expect(hasPendingTag).toBe(false)
    expect(renderedText(segments)).toBe(raw)
  })

  it('does not bail on tag syntax quoted inside a JSON string', () => {
    // The false positive this guards: a question whose text legitimately quotes
    // another tag. Bailing would show raw JSON that later snaps into a card.
    const streaming = 'ok <question>[{"type":"single_select","prompt":"Use the </options> tag?"'
    expect(parseSpecialTags(streaming, true).hasPendingTag).toBe(true)
  })

  it('resolves that same question correctly once it closes', () => {
    // The other half of the guarantee: the body the streaming case refused to
    // bail on does render as a question card, so nothing flickered for nothing.
    const complete =
      'ok <question>[{"type":"single_select","prompt":"Use the </options> tag?","options":[{"id":"y","label":"Yes"},{"id":"n","label":"No"}]}]</question>'
    const { segments } = parseSpecialTags(complete, false)
    expect(segments.some((s) => s.type === 'question')).toBe(true)
  })

  it('rejects an opener a nested one disproves, then judges the inner on its own', () => {
    // Each opener is evaluated independently. The first is disproved by the
    // nested opener and its text is released immediately; the second is a fresh
    // candidate that nothing has ruled out yet, so it holds mid-stream.
    const streaming = parseSpecialTags('a <thinking>b <thinking> c', true)
    expect(streaming.hasPendingTag).toBe(true)
    expect(renderedText(streaming.segments)).toBe('a <thinking>b ')

    // Once the stream ends nothing can close it, so the whole line is shown.
    const done = parseSpecialTags('a <thinking>b <thinking> c', false)
    expect(done.hasPendingTag).toBe(false)
    expect(renderedText(done.segments)).toBe('a <thinking>b <thinking> c')
  })

  it('keeps reasoning suppressed when the body merely contains angle brackets', () => {
    // The nesting rule keys on tag NAMES, not on anything tag-shaped. Reasoning
    // that mentions `<div>` or a generic is still reasoning; releasing it would
    // put the model's thinking on screen for an incidental angle bracket.
    const { segments } = parseSpecialTags('a <thinking>weighing a <div> here</thinking> b', false)

    expect(segments.some((segment) => segment.type === 'thinking')).toBe(true)
    expect(visibleView(segments).text).toBe('a  b')
  })

  it('renders nothing for a message that is only a discarded payload', () => {
    // `discard` emits no segment, so this is the one case that can end the parse
    // with an empty segment list. The fallback for an empty list is to emit the
    // raw content — which would put back the exact raw JSON the discard removed.
    const { segments } = parseSpecialTags('<question>{"type":"single_select"}</question>', false)

    expect(visibleView(segments).text).toBe('')
  })

  it('settles a long prose mention without scanning the whole window', () => {
    // Viability rejects on the first non-whitespace character when it is not `{`
    // or `[` — the common case. Testing that before blanking avoids copying a
    // full window per opener per chunk: 43ms to 2ms on this input.
    //
    // Asserted as a scaling ratio, not a wall-clock ceiling — see
    // {@link scalingRatioOver4x} for why.
    expect(scalingRatioOver4x((content) => parseSpecialTags(content, true))).toBeLessThan(8)
  })

  it('does not let a late thinking close swallow content already on screen', () => {
    // A nested marker disproves the outer <thinking> mid-stream, so its text is
    // released and the inner tag renders as a card. A prose body has no shape to
    // fail — any non-empty text qualifies — so when </thinking> finally arrives it
    // would be accepted as a segment, and everything already on screen would be
    // swallowed into it and suppressed. The nesting rule has to apply on the
    // matched-pair path too, not just while streaming.
    const raw = 'a <thinking>b <options>[{"title":"x","description":"y"}]</options> c</thinking> d'

    const settled = parseSpecialTags(raw, false)
    expect(settled.segments.some((segment) => segment.type === 'options')).toBe(true)
    expect(settled.segments.some((segment) => segment.type === 'thinking')).toBe(false)

    // And nothing retracts across the stream: no rendered card un-renders.
    const frames = replayFrames(raw)
    let previous = 0
    for (const frame of frames) {
      expect(frame.cardCount).toBeGreaterThanOrEqual(previous)
      previous = frame.cardCount
    }
  })

  it('hides an unclosed thinking body while streaming, then shows it once complete', () => {
    // A DELIBERATE trade, not an oversight. `thinking` bodies are prose, so the
    // JSON viability rule cannot apply and only the nesting rule can disprove the
    // opener — mid-stream the default is therefore to HIDE, since a close is
    // still plausible and releasing early would flash reasoning that is about to
    // become a suppressed segment.
    //
    // Once the stream ends the body is shown as text, which does leak the model's
    // reasoning for a message whose close never arrived. Accepted: forgetting the
    // close is rare, and the alternative — keeping it hidden — would swallow the
    // answer whenever the model opened `<thinking>` and then wrote the reply
    // without closing, which is the text-loss bug this whole change removes.
    const raw = 'a <thinking>still reasoning about'
    const streaming = parseSpecialTags(raw, true)
    expect(streaming.hasPendingTag).toBe(true)
    expect(renderedText(streaming.segments)).toBe('a ')

    const complete = parseSpecialTags(raw, false)
    expect(complete.hasPendingTag).toBe(false)
    expect(renderedText(complete.segments)).toBe(raw)
  })

  it('never retracts rendered text or a card across streamed frames', () => {
    // Frame-to-frame stability, which no end-state assertion can see. Replays a
    // real message one character at a time: text already shown must never
    // disappear, and a card once rendered must never revert to raw text.
    const content =
      'Updated <workspace_resource>{"type":"file","path":"files/a.md","title":"a.md"}</workspace_resource> ' +
      'and left `<question>` alone. ' +
      '<options>[{"title":"Ship it","description":"open the PR"}]</options>'

    const frames = replayFrames(content)

    // Card count is monotonically non-decreasing. Appending to the buffer can
    // only add closes AFTER the ones already matched, so no earlier opener's
    // resolution can change — a card that renders must never un-render.
    let previous = 0
    for (const frame of frames) {
      expect(frame.cardCount).toBeGreaterThanOrEqual(previous)
      previous = frame.cardCount
    }

    // The settled parse is the richest: both tags resolved, prose intact.
    const settled = frames[frames.length - 1]
    expect(settled.cardCount).toBe(2)
    expect(settled.text).toContain('and left `<question>` alone.')
  })

  it('renders an unclosed tag as text once the message is complete', () => {
    const content =
      'The `<workspace_resource>` file chip only renders when its path points to a real file.'
    const { segments, hasPendingTag } = parseSpecialTags(content, false)
    expect(hasPendingTag).toBe(false)
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
    expect(renderedText(segments)).toBe(content)
  })

  it('strips a trailing partial opening tag while streaming', () => {
    const { segments, hasPendingTag } = parseSpecialTags('Let me ask. <ques', true)
    expect(hasPendingTag).toBe(true)
    expect(segments).toEqual([{ type: 'text', content: 'Let me ask. ' }])
  })
})

describe('service_account credential tag', () => {
  it('parses a service_account tag into a credential segment', () => {
    const body = JSON.stringify({ type: 'service_account', provider: 'slack' })
    const { segments } = parseSpecialTags(`Set this up: <credential>${body}</credential>`, false)

    const credential = segments.find((segment) => segment.type === 'credential')
    expect(credential).toBeDefined()
    expect(credential).toMatchObject({
      type: 'credential',
      data: [{ type: 'service_account', provider: 'slack' }],
    })
  })

  it('carries no value — the secret is typed into Sim’s own form, never the transcript', () => {
    const body = JSON.stringify({ type: 'service_account', provider: 'google-sheets' })
    const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)

    const credential = segments.find((segment) => segment.type === 'credential')
    expect((credential as { data: Array<{ value?: string }> }).data[0].value).toBeUndefined()
  })

  it('suppresses the tag while it is still streaming', () => {
    // A half-streamed tag must not flash raw JSON into the message body.
    const { segments, hasPendingTag } = parseSpecialTags(
      'Set this up: <credential>{"type": "service_a',
      true
    )
    expect(hasPendingTag).toBe(true)
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
    const text = segments
      .filter((segment): segment is { type: 'text'; content: string } => segment.type === 'text')
      .map((segment) => segment.content)
      .join('')
    expect(text).not.toContain('service_a')
  })
})

describe('service_account tag validation', () => {
  it('rejects a provider-less tag, which would render an unresolvable control', () => {
    const { segments } = parseSpecialTags(
      `<credential>${JSON.stringify({ type: 'service_account' })}</credential>`,
      false
    )
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
  })

  it('rejects a blank provider', () => {
    const { segments } = parseSpecialTags(
      `<credential>${JSON.stringify({ type: 'service_account', provider: '   ' })}</credential>`,
      false
    )
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
  })

  it('accepts an optional credentialId for reconnect and carries it through', () => {
    const body = JSON.stringify({
      type: 'service_account',
      provider: 'notion',
      credentialId: 'cred_abc123',
    })
    const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)
    const credential = segments.find((segment) => segment.type === 'credential')
    expect(credential).toMatchObject({
      type: 'credential',
      data: [{ type: 'service_account', provider: 'notion', credentialId: 'cred_abc123' }],
    })
  })

  it('rejects a non-string credentialId', () => {
    const body = JSON.stringify({ type: 'service_account', provider: 'notion', credentialId: 42 })
    const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)
    expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
  })

  it.each(['', '   '])(
    'rejects a blank credentialId (%j) so reconnect cannot target a missing credential',
    (credentialId) => {
      const body = JSON.stringify({ type: 'service_account', provider: 'notion', credentialId })
      const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)
      expect(segments.some((segment) => segment.type === 'credential')).toBe(false)
    }
  )
})

describe('memoizedIndexOf', () => {
  const CONTENT =
    'Use <workspace_resource> for files. Use <question> for cards. ' +
    '<options>[{"title":"Ship","description":"go"}]</options> and <question> again.'
  // Every opener the parser actually searches for, not a hand-picked few: the
  // cache is keyed per needle, so a needle absent from CONTENT exercises the
  // cached -1 path and a repeated one exercises reuse as the cursor advances.
  const NEEDLES = SPECIAL_TAG_NAMES.map((name) => `<${name}>`)

  it('matches plain indexOf as the cursor advances', () => {
    const cache: IndexOfCache = new Map()
    for (let from = 0; from <= CONTENT.length; from++) {
      for (const needle of NEEDLES) {
        expect(memoizedIndexOf(cache, CONTENT, needle, from)).toBe(CONTENT.indexOf(needle, from))
      }
    }
  })

  it('stays correct when the cursor moves BACKWARD', () => {
    // The cache is only reused when the new `from` is at or beyond the offset the
    // entry was searched at. Without that guard a cached hit — or a cached -1 —
    // is returned for a region it never examined, and the parser silently
    // mis-parses rather than failing loudly.
    //
    // parseSpecialTags never walks backward today, so this cannot be provoked
    // through the public API; the point is that a future change to a resume point
    // costs a redundant scan instead of a wrong answer.
    const cache: IndexOfCache = new Map()
    const offsets = [70, 5, 100, 0, 45, 62, 12, CONTENT.length, 40, 3]
    for (const from of offsets) {
      for (const needle of NEEDLES) {
        expect(memoizedIndexOf(cache, CONTENT, needle, from)).toBe(CONTENT.indexOf(needle, from))
      }
    }
  })

  it('caches an absent needle instead of rescanning', () => {
    const cache: IndexOfCache = new Map()
    expect(memoizedIndexOf(cache, CONTENT, '<thinking>', 0)).toBe(-1)
    // Same offset or later: answerable from the entry, since absence from 0
    // implies absence from anywhere after it.
    expect(memoizedIndexOf(cache, CONTENT, '<thinking>', 30)).toBe(-1)
    expect(cache.get('<thinking>')).toEqual({ idx: -1, from: 0 })
  })
})

/**
 * Property tests over generated messages.
 *
 * The example tests above each pin one shape that was once broken. They cannot
 * cover the space: a body is judged on body kind, close state, JSON state, marker
 * placement, size against the scan window, and streaming mode — a product of
 * roughly six hundred combinations, each needing both an outcome and a resume
 * point. Every regression found in review so far was a cell nobody had written an
 * example for.
 *
 * These assert invariants instead, over messages composed from fragments, so a
 * new combination is covered without a new test. Seeded so a failure reproduces.
 */
describe('parser properties', () => {
  /** mulberry32 — deterministic, so a failing case is reproducible from its seed. */
  function makeRng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /**
   * One valid payload per card-rendering tag, keyed by tag name so
   * {@link SPECIAL_TAG_NAMES} can be checked for full coverage below. Hand-picking
   * a subset is how three of these went unexercised by every invariant without
   * anything failing to say so.
   */
  const VALID_TAG_BY_NAME: Record<string, string> = {
    workspace_resource:
      '<workspace_resource>{"type":"file","path":"files/a.md","title":"a.md"}</workspace_resource>',
    options: '<options>[{"title":"Ship it","description":"Open the PR"}]</options>',
    question: `<question>${JSON.stringify(SINGLE_SELECT)}</question>`,
    credential:
      '<credential>{"type":"link","provider":"slack","value":"https://x.example/p"}</credential>',
    usage_upgrade:
      '<usage_upgrade>{"reason":"monthly cap","action":"upgrade_plan","message":"You hit your limit."}</usage_upgrade>',
    'mothership-error':
      '<mothership-error>{"message":"The tool call failed.","code":"E_TOOL"}</mothership-error>',
    source: '<source>{"url":"https://docs.github.com/en/x","siteName":"GitHub Docs"}</source>',
  }

  /** Renders nothing rather than a card, so it cannot carry a card invariant. */
  const TAGS_WITHOUT_CARDS = ['thinking']

  const VALID_TAGS = Object.values(VALID_TAG_BY_NAME)

  it('covers every tag the parser knows', () => {
    // The invariants below are only as good as this list. Deriving the check from
    // SPECIAL_TAG_NAMES makes adding a tag without a fixture fail loudly here,
    // instead of quietly leaving it outside every property in this file.
    expect(new Set([...Object.keys(VALID_TAG_BY_NAME), ...TAGS_WITHOUT_CARDS])).toEqual(
      new Set(SPECIAL_TAG_NAMES)
    )
  })

  /**
   * Fragments that must survive verbatim. Every one is a shape the parser has to
   * reject: prose mentions, malformed closes, bodies that never were payloads.
   * Nothing here is eligible for `discard` — which makes "output equals input" a
   * legal assertion. That takes two properties, not one: no fragment is a
   * well-formed payload (`wrong-shape`), and the `{"`-opening bodies never land
   * in a marker-free matched pair (`not-parsable`) — their own close is
   * misspelled, truncated, or absent, so any close they borrow from a later
   * fragment drags that fragment's own opener into the body, and the
   * nested-marker rule settles the span before the attempted-payload test runs.
   */
  const LOSSLESS_FRAGMENTS = [
    'Plain prose with no markup at all. ',
    'A `<workspace_resource>` mention in prose. ',
    'Talking about `<question>` and `<options>` together. ',
    '<workspace_resource>{"type":"file","path":"a.md"}</workflow_resource> misspelled close. ',
    '<workspace_resource>{"type":"file","path":"a.md"}</workspac truncated close. ',
    '<workspace_resource>{"type":"file","path":"a.md"} and then prose, no close. ',
    '<workspace_resource>{the Q4 report}</workspace_resource> braces round prose. ',
    '<workspace_resource>{type: "file", path: "a.md"}</workspace_resource> unquoted keys. ',
    "<workspace_resource>{'type':'file'}</workspace_resource> single quotes. ",
    '<workspace_resource>the gmail-agent workflow</workspace_resource> prose body. ',
    '<thinking>reasoning <options> with a nested marker</thinking> after. ',
    '<workspace_resource>the notes file "notes.md unbalanced quote</workspace_resource> after. ',
    '<workspace_resource>notes "unbalanced then <options> marker</workspace_resource> tail. ',
    '\n\nA paragraph break above. ',
    `${'long filler prose. '.repeat(300)}crossing the scan window. `,
  ]

  const pick = <T>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)]

  function buildLossless(rng: () => number, pool = LOSSLESS_FRAGMENTS): string {
    const n = 1 + Math.floor(rng() * 5)
    return Array.from({ length: n }, () => pick(rng, pool)).join('')
  }

  /**
   * The same shapes without the window-crossing filler.
   *
   * Frame replay parses every prefix, so message length multiplies into parse
   * count — the filler fragment alone took that property to ~1M parses and 1.7s,
   * 95% of this file's runtime. Retraction is a property of what happens AT a
   * frame boundary, so it is exercised by the boundaries, not by message size.
   * The scan window still gets its coverage from the other properties, which
   * parse each message once.
   */
  const SHORT_FRAGMENTS = LOSSLESS_FRAGMENTS.filter((fragment) => fragment.length < 200)

  it('never loses a character of a message with nothing droppable in it', () => {
    // The headline guarantee. Only a well-formed payload that failed its shape
    // guard may be removed, and no fragment here is one.
    for (let seed = 1; seed <= 400; seed++) {
      const raw = buildLossless(makeRng(seed))
      const { segments } = parseSpecialTags(raw, false)
      expect(renderedText(segments), `seed ${seed}`).toBe(raw)
    }
  })

  it('renders every valid tag as a card whatever surrounds it', () => {
    // A valid tag was flattened to text purely because of how much
    // prose preceded it, which no fixed example set would have found.
    for (let seed = 1; seed <= 400; seed++) {
      const rng = makeRng(seed)
      const tags = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(rng, VALID_TAGS))
      const parts: string[] = []
      for (const tag of tags) {
        // Several fragments, not one: the interesting shapes need an unclosed
        // opener AND enough prose after it to push the valid tag past the scan
        // window, so the opener borrows that tag's close from beyond what the
        // parser inspected. One fragment between tags can never build that.
        const run = 1 + Math.floor(rng() * 3)
        for (let i = 0; i < run; i++) parts.push(pick(rng, LOSSLESS_FRAGMENTS))
        parts.push(tag)
      }
      parts.push(pick(rng, LOSSLESS_FRAGMENTS))
      const raw = parts.join('')

      const { segments } = parseSpecialTags(raw, false)
      const cards = segments.filter(
        (segment) => segment.type !== 'text' && segment.type !== 'thinking'
      )
      expect(cards, `seed ${seed}`).toHaveLength(tags.length)
    }
  })

  it('never un-renders a card or retracts text across streamed frames', () => {
    // Content already on screen disappeared when a later close
    // arrived. Only visible across frames, never in an end-state assertion.
    //
    // Text may shrink slightly at a frame edge: a half-arrived opening marker is
    // deliberately hidden so it does not flash. That is bounded by the longest
    // opener, so anything beyond it is a real retraction.
    const LONGEST_OPENER = '<workspace_resource>'.length + 1

    for (let seed = 1; seed <= 120; seed++) {
      const rng = makeRng(seed)
      const raw = `${buildLossless(rng, SHORT_FRAGMENTS)}${pick(rng, VALID_TAGS)}${buildLossless(rng, SHORT_FRAGMENTS)}`

      let previousCards = 0
      let previousText = ''
      for (const frame of replayFrames(raw, 7)) {
        expect(frame.cardCount, `seed ${seed}: card un-rendered`).toBeGreaterThanOrEqual(
          previousCards
        )

        const stable = previousText.slice(0, Math.max(0, previousText.length - LONGEST_OPENER))
        expect(frame.text.startsWith(stable), `seed ${seed}: text retracted`).toBe(true)

        previousCards = frame.cardCount
        previousText = frame.text
      }
    }
  })

  it('settles to at least what the last streaming frame showed', () => {
    // The stream ending must only ever reveal more. A settled parse that renders
    // fewer cards than the frame before it is a retraction the user watches happen.
    for (let seed = 1; seed <= 200; seed++) {
      const rng = makeRng(seed)
      const raw = `${buildLossless(rng)}${pick(rng, VALID_TAGS)}${buildLossless(rng)}`

      const lastFrame = visibleView(parseSpecialTags(raw, true).segments)
      const settled = visibleView(parseSpecialTags(raw, false).segments)

      expect(settled.cardCount, `seed ${seed}`).toBeGreaterThanOrEqual(lastFrame.cardCount)
      expect(settled.text.length, `seed ${seed}`).toBeGreaterThanOrEqual(lastFrame.text.length)
    }
  })
})

describe('flattened options payload recovery', () => {
  // Observed in the wild: no <options> wrapper, and the LAST entry lost its
  // braces so its title sits on the numeric key with the description hoisted.
  const flattened =
    'options {"1": {"title": "Test files and a second turn in the same DM thread", "description": "watermark + file-delta live check"}, "2": {"title": "Put /chat/the-elder on Brain with a password", "description": "finish chat cutover"}, "3": "Add thinking-status keepalive for long Brain runs", "description": "refresh shimmer past 2 minutes"}'

  it('renders it as an options card instead of raw JSON', () => {
    const { segments } = parseSpecialTags(flattened, false)
    const options = segments.find((segment) => segment.type === 'options')
    expect(options).toBeDefined()
    expect(Object.keys((options as { data: Record<string, unknown> }).data)).toEqual([
      '1',
      '2',
      '3',
    ])
  })

  it('rebuilds the flattened entry from the hoisted description', () => {
    const { segments } = parseSpecialTags(flattened, false)
    const data = (segments.find((s) => s.type === 'options') as { data: Record<string, unknown> })
      .data
    expect(data['3']).toEqual({
      title: 'Add thinking-status keepalive for long Brain runs',
      description: 'refresh shimmer past 2 minutes',
    })
  })

  it('drops the bare "options" label rather than leaving it as prose', () => {
    const { segments } = parseSpecialTags(flattened, false)
    expect(segments.some((segment) => segment.type === 'text')).toBe(false)
  })

  it('repairs the same corruption inside a well-formed tag', () => {
    const tagged =
      '<options>{"1": {"title": "A", "description": "a"}, "2": "B", "description": "b"}</options>'
    const { segments } = parseSpecialTags(tagged, false)
    const data = (segments.find((s) => s.type === 'options') as { data: Record<string, unknown> })
      .data
    expect(data['2']).toEqual({ title: 'B', description: 'b' })
  })

  it('leaves prose JSON alone', () => {
    const prose = 'Here is the config: {"name": "x", "description": "y"}'
    const { segments } = parseSpecialTags(prose, false)
    expect(segments.some((segment) => segment.type === 'options')).toBe(false)
  })

  it('does not fire mid-stream', () => {
    expect(parseSpecialTags(flattened, true).segments.some((s) => s.type === 'options')).toBe(false)
  })
})

describe('bare options with a capitalized label', () => {
  // Well-formed payload, but no wrapper and a "Options:" label instead of the
  // lowercase bare word — the second shape seen in the wild.
  const labeled =
    'Options: {"1": {"title": "Live-test ASK top-level, ASK thread, and a mention in another channel", "description": "confirm the new accept rule in Slack"}, "2": {"title": "Test files and a second turn in the same DM thread", "description": "watermark + file-delta live check"}}'

  it('renders it as an options card', () => {
    const { segments } = parseSpecialTags(labeled, false)
    const options = segments.find((segment) => segment.type === 'options')
    expect(options).toBeDefined()
    expect(Object.keys((options as { data: Record<string, unknown> }).data)).toEqual(['1', '2'])
  })

  it('leaves no stray "Options:" prose above the card', () => {
    const { segments } = parseSpecialTags(labeled, false)
    expect(segments.some((segment) => segment.type === 'text')).toBe(false)
  })

  it('keeps real prose that precedes the payload', () => {
    const withProse = `Here is what I suggest.\n\n${labeled}`
    const { segments } = parseSpecialTags(withProse, false)
    const text = segments.find((segment) => segment.type === 'text') as { content: string }
    expect(text.content).toBe('Here is what I suggest.')
    expect(segments.some((segment) => segment.type === 'options')).toBe(true)
  })
})

describe('bare options JSON with no label at all', () => {
  const naked =
    '{"1": {"title": "Live-test ASK top-level, ASK thread, and a mention in another channel", "description": "confirm the new accept rule in Slack"}, "2": {"title": "Test files and a second turn in the same DM thread", "description": "watermark + file-delta live check"}}'

  it('renders the payload alone as an options card', () => {
    const { segments } = parseSpecialTags(naked, false)
    const options = segments.find((segment) => segment.type === 'options')
    expect(options).toBeDefined()
    expect(Object.keys((options as { data: Record<string, unknown> }).data)).toEqual(['1', '2'])
    expect(segments.some((segment) => segment.type === 'text')).toBe(false)
  })

  it('renders it after prose with no label between them', () => {
    const { segments } = parseSpecialTags(`Two ways to go from here.\n\n${naked}`, false)
    const text = segments.find((segment) => segment.type === 'text') as { content: string }
    expect(text.content).toBe('Two ways to go from here.')
    expect(segments.some((segment) => segment.type === 'options')).toBe(true)
  })

  it('recovers a flattened payload with no label either', () => {
    const flattenedNaked = '{"1": {"title": "A", "description": "a"}, "2": "B", "description": "b"}'
    const { segments } = parseSpecialTags(flattenedNaked, false)
    const data = (segments.find((s) => s.type === 'options') as { data: Record<string, unknown> })
      .data
    expect(data['2']).toEqual({ title: 'B', description: 'b' })
  })
})

describe('bare question payload recovery', () => {
  const bare =
    '{"type": "single_select", "prompt": "Which channel should the bot post to?", "options": [{"id": "a", "label": "#general"}, {"id": "b", "label": "#alerts"}]}'

  it('renders an unwrapped question payload as a question card', () => {
    const { segments } = parseSpecialTags(bare, false)
    const question = segments.find((segment) => segment.type === 'question')
    expect(question).toBeDefined()
    expect((question as { data: Array<{ prompt: string }> }).data[0].prompt).toBe(
      'Which channel should the bot post to?'
    )
    expect(segments.some((segment) => segment.type === 'text')).toBe(false)
  })

  it('accepts an array payload and strips a bare label', () => {
    const { segments } = parseSpecialTags(`Question: [${bare}]`, false)
    expect(segments.some((segment) => segment.type === 'question')).toBe(true)
    expect(segments.some((segment) => segment.type === 'text')).toBe(false)
  })

  it('keeps prose that precedes the payload', () => {
    const { segments } = parseSpecialTags(`I need one detail.\n\n${bare}`, false)
    const text = segments.find((segment) => segment.type === 'text') as { content: string }
    expect(text.content).toBe('I need one detail.')
  })

  it('does not fire mid-stream', () => {
    expect(parseSpecialTags(bare, true).segments.some((s) => s.type === 'question')).toBe(false)
  })
})

describe('ordinary JSON in prose is never turned into a card', () => {
  const prose = [
    'Here is the config: {"name": "elder", "description": "the bot", "enabled": true}',
    'The API returned {"1": "ok", "2": "ok"}',
    'Response shape: {"type": "object", "prompt": "n/a", "options": []}',
    'Use {"type": "single_select"} as the discriminator.',
    'Rows: [{"id": "1", "label": "one"}, {"id": "2", "label": "two"}]',
    'Payload: {"data": {"title": "x", "description": "y"}}',
    'Env: {"0": {"title": "a", "description": "b"}}',
  ]

  it.each(prose)('leaves %s as text', (content) => {
    const { segments } = parseSpecialTags(content, false)
    expect(segments.some((s) => s.type === 'options' || s.type === 'question')).toBe(false)
    expect(segments.some((s) => s.type === 'text')).toBe(true)
  })
})

describe('source tag', () => {
  it('parses a complete source tag into a source segment', () => {
    const { segments } = parseSpecialTags(
      'Remove them first. <source>{"url":"https://docs.github.com/en/x","siteName":"GitHub Docs","title":"Blocking users"}</source> Then block.',
      false
    )

    expect(segments).toEqual([
      { type: 'text', content: 'Remove them first. ' },
      {
        type: 'source',
        data: {
          url: 'https://docs.github.com/en/x',
          siteName: 'GitHub Docs',
          title: 'Blocking users',
        },
      },
      { type: 'text', content: ' Then block.' },
    ])
  })

  it('keeps adjacent source tags as separate segments', () => {
    const { segments } = parseSpecialTags(
      'Done. <source>{"url":"https://a.example/1"}</source><source>{"url":"https://b.example/2"}</source>',
      false
    )

    expect(segments.filter((segment) => segment.type === 'source')).toHaveLength(2)
  })

  it('rejects a source without an absolute http(s) url', () => {
    for (const url of ['docs/internal.md', 'https://?', 'ftp://host/x', 'https://a b.example/x']) {
      const { segments } = parseSpecialTags(
        `See <source>{"url":"${url}","siteName":"Docs"}</source>.`,
        false
      )

      expect(segments.some((segment) => segment.type === 'source')).toBe(false)
    }
  })

  it('hides a half-arrived source opener while streaming', () => {
    const { segments, hasPendingTag } = parseSpecialTags('Block them. <sou', true)

    expect(segments).toEqual([{ type: 'text', content: 'Block them. ' }])
    expect(hasPendingTag).toBe(true)
  })
})
