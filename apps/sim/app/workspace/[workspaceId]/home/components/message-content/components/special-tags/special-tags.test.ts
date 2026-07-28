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

import type {
  ContentSegment,
  IndexOfCache,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import {
  memoizedIndexOf,
  parseQuestionTagBody,
  parseSpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

/**
 * What a reader actually sees: the renderer concatenates adjacent text segments
 * into one markdown string, so how a span is split across segments is not
 * observable. Assert on this rather than on segment-array shape.
 */
function renderedText(segments: ContentSegment[]): string {
  return segments.map((segment) => ('content' in segment ? segment.content : '')).join('')
}

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
    // Before the rewrite, rejecting an unclosed tag abandoned the rest of the
    // message, so this <options> tag was never parsed at all.
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
    // Pins WHY the two literal reasons resume at different offsets. A
    // never-a-payload body resumes past the CLOSE; resuming past the opener
    // instead would rescan the interior, and since the marker scan runs on the
    // blanked body, a tag quoted inside a JSON string is invisible to it and
    // would be re-parsed as a real tag on the second pass — then dropped,
    // deleting the very text this parser exists to preserve.
    const raw =
      'A <question>{"a":"<options>{\\"k\\":{\\"title\\":\\"x\\",\\"description\\":\\"y\\"}}</options>"} junk</question> B'
    const { segments } = parseSpecialTags(raw, false)
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
    expect(renderedText(segments)).toBe(raw)
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
    // Scanning the raw body sees `</options>` inside the prompt, calls the span
    // literal text, and renders the raw payload — the outcome `discard` exists
    // to prevent.
    const { segments } = parseSpecialTags(
      'A <question>[{"type":"single_select","prompt":"use </options> here?"}]</question> B',
      false
    )
    expect(renderedText(segments)).toBe('A  B')
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

  it('still renders a matched pair whose body IS valid', () => {
    const raw =
      'see <workspace_resource>{"type":"file","path":"files/a.md","title":"a.md"}</workspace_resource> ok'
    const { segments } = parseSpecialTags(raw, false)
    expect(segments.some((s) => s.type === 'workspace_resource')).toBe(true)
  })

  it('shows prose immediately mid-stream instead of blanking the rest', () => {
    // The failure this replaces: everything after the marker stayed invisible
    // for the remainder of the stream, then reappeared when it ended.
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
    const content = 'The <workspace_resource> tag is used here. '.repeat(2000)

    const startedAt = performance.now()
    parseSpecialTags(content, true)
    expect(performance.now() - startedAt).toBeLessThan(20)
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
    // Asserted on the joined text, not segment boundaries: the renderer
    // concatenates adjacent text segments, so how the span is split is not
    // observable to a reader.
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
      data: { type: 'service_account', provider: 'slack' },
    })
  })

  it('carries no value — the secret is typed into Sim’s own form, never the transcript', () => {
    const body = JSON.stringify({ type: 'service_account', provider: 'google-sheets' })
    const { segments } = parseSpecialTags(`<credential>${body}</credential>`, false)

    const credential = segments.find((segment) => segment.type === 'credential')
    expect((credential as { data: { value?: string } }).data.value).toBeUndefined()
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
      data: { type: 'service_account', provider: 'notion', credentialId: 'cred_abc123' },
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
  const NEEDLES = ['<workspace_resource>', '<question>', '<options>', '<thinking>']

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

  const VALID_TAGS = [
    '<workspace_resource>{"type":"file","path":"files/a.md","title":"a.md"}</workspace_resource>',
    '<options>[{"title":"Ship it","description":"Open the PR"}]</options>',
    `<question>${JSON.stringify(SINGLE_SELECT)}</question>`,
  ]

  /**
   * Fragments that must survive verbatim. Every one is a shape the parser has to
   * reject: prose mentions, malformed closes, bodies that never were payloads.
   * None is a valid tag and none is a well-formed payload, so nothing here is
   * eligible for `discard` — which makes "output equals input" a legal assertion.
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
    // Round-3 class: a valid tag was flattened to text purely because of how much
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
    // Round-5 class: content already on screen disappeared when a later close
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
