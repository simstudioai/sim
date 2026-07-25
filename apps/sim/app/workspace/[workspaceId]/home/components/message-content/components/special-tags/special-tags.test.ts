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

import {
  parseQuestionTagBody,
  parseSpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

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

    const rendered = parseSpecialTags(raw, false)
      .segments.map((segment) => ('content' in segment ? segment.content : ''))
      .join('')

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
    const join = (result: ReturnType<typeof parseSpecialTags>) =>
      result.segments.map((segment) => ('content' in segment ? segment.content : '')).join('')

    const streaming = parseSpecialTags(raw, true)
    expect(streaming.hasPendingTag).toBe(false)
    expect(join(streaming)).toBe(raw)
    expect(join(parseSpecialTags(raw, false))).toBe(raw)
  })

  it('keeps prose a tag wrapped instead of a payload', () => {
    // Verbatim from a real message (trace 1206fd8a): a matched pair whose body
    // is plain prose, never an attempted JSON payload. The sentence read
    // "...once I wired up to handle the welcome sequence" with the subject gone.
    const raw =
      'once I wired up <workspace_resource>the gmail-agent workflow</workspace_resource> to handle the welcome sequence.'
    const rendered = parseSpecialTags(raw, false)
      .segments.map((segment) => ('content' in segment ? segment.content : ''))
      .join('')
    expect(rendered).toContain('the gmail-agent workflow')
    expect(rendered).toContain('to handle the welcome sequence')
  })

  it('still drops a marker-free malformed payload rather than showing raw JSON', () => {
    // The complement of the case above: no tag markers in the body, so this is
    // a genuinely broken emission from the agent, not swallowed prose.
    const { segments, hasPendingTag } = parseSpecialTags(
      'Before. <question>{"type":"single_select"}</question> After.',
      false
    )
    expect(hasPendingTag).toBe(false)
    expect(segments).toEqual([
      { type: 'text', content: 'Before. ' },
      { type: 'text', content: ' After.' },
    ])
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
    expect(segments).toEqual([
      { type: 'text', content: 'A ' },
      { type: 'text', content: ' B' },
    ])
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
      expect(segments.map((s) => ('content' in s ? s.content : '')).join('')).toBe('see ')
    }
  })

  it('still rejects a close whose name is wrong rather than merely unfinished', () => {
    // The counterpart to the case above: `</workflow_resource>` can never grow
    // into `</workspace_resource>`, so it settles immediately instead of hiding
    // the rest of the message for the remainder of the stream.
    const { hasPendingTag } = parseSpecialTags(
      'see <workspace_resource>{"type":"file","path":"a.md"}</workflow_resource> and then prose.',
      true
    )
    expect(hasPendingTag).toBe(false)
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
    expect(segments.map((s) => ('content' in s ? s.content : '')).join('')).toContain(
      '</workflow_resource>'
    )
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
    expect(segments.map((s) => ('content' in s ? s.content : '')).join('')).toContain(
      'I brew a cup of coffee'
    )
  })

  it('tolerates braces inside JSON strings when tracking depth', () => {
    const raw = 'x <workspace_resource>{"title":"a } b","path":"files/a.md"'
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

  it('bails when a foreign closing tag appears inside the body', () => {
    // Tags never nest, so a close for a different tag proves the opener was text.
    // The array is left UNCLOSED on purpose: with a closed value the JSON rule
    // would independently reject the trailing content, and this test would still
    // pass with the nesting rule deleted. Unclosed, only nesting can explain it.
    const { hasPendingTag } = parseSpecialTags('see <options>[{"title":"a" </question> more', true)
    expect(hasPendingTag).toBe(false)
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

  it('still bails on a marker outside the JSON strings', () => {
    // Escapes must not end the string early, and a marker in real body position
    // is still evidence.
    const streaming = 'ok <question>[{"prompt":"a \\" quote"} </options>'
    expect(parseSpecialTags(streaming, true).hasPendingTag).toBe(false)
  })

  it('rejects an opener a nested one disproves, then judges the inner on its own', () => {
    // Each opener is evaluated independently. The first is disproved by the
    // nested opener and its text is released immediately; the second is a fresh
    // candidate that nothing has ruled out yet, so it holds mid-stream.
    const streaming = parseSpecialTags('a <thinking>b <thinking> c', true)
    expect(streaming.hasPendingTag).toBe(true)
    expect(
      streaming.segments.map((segment) => ('content' in segment ? segment.content : '')).join('')
    ).toBe('a <thinking>b ')

    // Once the stream ends nothing can close it, so the whole line is shown.
    const done = parseSpecialTags('a <thinking>b <thinking> c', false)
    expect(done.hasPendingTag).toBe(false)
    expect(
      done.segments.map((segment) => ('content' in segment ? segment.content : '')).join('')
    ).toBe('a <thinking>b <thinking> c')
  })

  it('keeps suppressing an unclosed thinking tag with prose — its body is not JSON', () => {
    // Documents the deliberate gap: `thinking` bodies are prose, so the JSON
    // heuristic cannot apply and only the nesting rule can rescue it.
    const { hasPendingTag } = parseSpecialTags('a <thinking>still reasoning about', true)
    expect(hasPendingTag).toBe(true)
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
    expect(segments.map((segment) => ('content' in segment ? segment.content : '')).join('')).toBe(
      content
    )
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
