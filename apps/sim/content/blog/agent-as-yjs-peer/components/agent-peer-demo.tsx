'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A small illustration for the post: two peers editing one document at once. A teammate ("Zoe")
 * extends the intro line while the agent ("Sim") writes a short formatted block below (bold lead,
 * code chip, bullet list). Neither overwrites the other. A scripted animation, but faithful to the
 * idea: both carets advance independently and both edits land.
 *
 * Styled from the same design tokens as the real markdown editor, with carets replicating
 * `CollaborationCaret` and identity colors from `USER_COLORS`. The finished document is always laid
 * out; unrevealed text is kept `visibility: hidden` so the card never resizes as content streams in.
 * Degrades to the finished document with JavaScript off or reduced motion.
 */

type Seg = { t: string } | { code: string } | { b: string }
interface Block {
  kind: 'p' | 'li'
  segs: Seg[]
}

const FONT_SANS = 'var(--font-inter, ui-sans-serif, system-ui, -apple-system, sans-serif)'
const FONT_MONO = 'var(--font-martian-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'

// Colors from the real identity palette (USER_COLORS / getUserColor).
const AGENT = { name: 'Sim', color: '#60C5FF' }
const HUMAN = { name: 'Zoe', color: '#F472B6' }

// The intro line already exists; the teammate is still appending to it.
const HUMAN_BASE = 'Rollout is set for Friday.'
const HUMAN_ADD = ' Ops signed off this morning.'

// The agent's block, streamed one char at a time, arriving already formatted.
const AGENT_BLOCKS: Block[] = [
  {
    kind: 'p',
    segs: [{ b: 'Load test: ' }, { t: 'p95 held at ' }, { code: '180ms' }, { t: ', errors flat.' }],
  },
  { kind: 'li', segs: [{ t: 'Rollback path verified' }] },
  { kind: 'li', segs: [{ t: 'On-call paged and acked' }] },
]

const segText = (s: Seg): string => ('t' in s ? s.t : 'code' in s ? s.code : s.b)
const AGENT_FLAT = AGENT_BLOCKS.flatMap((b) => b.segs.map(segText)).join('')
const HUMAN_TOTAL = HUMAN_ADD.length
const AGENT_TOTAL = AGENT_FLAT.length

/**
 * Per-character reveal timeline with a deterministic (no-RNG) speed wobble plus pauses at spaces and
 * punctuation, so the server and client agree and it never jitters between renders. `times[i]` is the
 * ms at which character `i` appears.
 */
function buildSchedule(
  text: string,
  o: { base: number; wobble: number; space: number; punct: number; startAt?: number }
): number[] {
  const times: number[] = []
  let t = o.startAt ?? 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const wob = 1 + o.wobble * (0.6 * Math.sin(i * 1.7 + 0.5) + 0.4 * Math.sin(i * 0.53 + 1.1))
    t += o.base * wob
    if (ch === ' ') t += o.space
    else if (ch === '.' || ch === ',' || ch === ':') t += o.punct
    times.push(t)
  }
  return times
}

// Agent streams faster and steadier; the human is slower and starts a beat later, so the two never lock in sync.
const AGENT_TIMES = buildSchedule(AGENT_FLAT, { base: 34, wobble: 0.5, space: 45, punct: 150 })
const HUMAN_TIMES = buildSchedule(HUMAN_ADD, {
  base: 58,
  wobble: 0.45,
  space: 65,
  punct: 150,
  startAt: 280,
})

const lastTime = (a: number[]) => (a.length ? a[a.length - 1] : 0)
const countReached = (times: number[], t: number): number => {
  let n = 0
  while (n < times.length && times[n] <= t) n++
  return n
}

// RUN_MS: when the last character lands. The stream plays once, then clamps to the finished doc and stops.
const RUN_MS = Math.max(lastTime(AGENT_TIMES), lastTime(HUMAN_TIMES))

const proseStyle: React.CSSProperties = {
  fontFamily: FONT_SANS,
  fontSize: '15px',
  fontWeight: 430,
  lineHeight: '25px',
  letterSpacing: 0,
  color: 'var(--text-primary)',
  overflowWrap: 'anywhere',
}

const codeStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: '0.875em',
  background: 'var(--surface-5)',
  borderRadius: '4px',
  padding: '0.125rem 0.375rem',
}

/** Replicates CollaborationCaret (rich-markdown-editor.css): a 2px identity-colored bar with the
 *  notched name label above it. Zero inline width, so placing it at the write head never shifts text. */
function Caret({ who }: { who: typeof HUMAN }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        width: 0,
        height: '1em',
        verticalAlign: 'text-bottom',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '-0.15em',
          height: '1.3em',
          left: '-1px',
          width: '2px',
          background: who.color,
          pointerEvents: 'none',
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: '-1.5em',
          left: '-1px',
          padding: '0.1rem 0.35rem',
          borderRadius: '2px 2px 2px 0',
          fontFamily: FONT_SANS,
          fontSize: '11px',
          fontWeight: 500,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          background: who.color,
          color: 'var(--surface-1)',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {who.name}
      </span>
    </span>
  )
}

/** Renders a block's segments, revealing up to `revealed` chars and reserving the rest with
 *  `visibility: hidden` for stable layout. Places the caret at the write head if it falls in this
 *  block; returns the nodes and whether the caret was placed. */
function renderBlockNodes(
  block: Block,
  blockStart: number,
  revealed: number,
  placed: boolean,
  isLast: boolean
) {
  const nodes: React.ReactNode[] = []
  let offset = blockStart
  let didPlace = placed
  for (let si = 0; si < block.segs.length; si++) {
    const seg = block.segs[si]
    const raw = segText(seg)
    const start = offset
    const end = offset + raw.length
    const key = `${blockStart}-${si}`

    if ('code' in seg) {
      // Type the chip char by char with the caret moving through it; the box reserves full width up
      // front (hidden tail) so the card never reflows. Revealing it as one chunk froze/jumped the caret.
      const reached = revealed >= start
      const shown = reached ? Math.min(raw.length, revealed - start) : 0
      const atBoundary = !didPlace && reached && shown < raw.length
      if (atBoundary) didPlace = true
      nodes.push(
        <code key={key} style={{ ...codeStyle, visibility: reached ? 'visible' : 'hidden' }}>
          {reached ? raw.slice(0, shown) : raw}
          {atBoundary && <Caret key={`${key}-c`} who={AGENT} />}
          {reached && shown < raw.length && (
            <span style={{ visibility: 'hidden' }}>{raw.slice(shown)}</span>
          )}
        </code>
      )
    } else {
      const shown = Math.max(0, Math.min(raw.length, revealed - start))
      const vis = raw.slice(0, shown)
      const hid = raw.slice(shown)
      const weight = 'b' in seg ? 600 : undefined
      if (vis) {
        nodes.push(
          <span key={`${key}-v`} style={{ fontWeight: weight }}>
            {vis}
          </span>
        )
      }
      if (!didPlace && revealed >= start && revealed <= end && shown < raw.length) {
        nodes.push(<Caret key={`${key}-c`} who={AGENT} />)
        didPlace = true
      }
      if (hid) {
        nodes.push(
          <span key={`${key}-h`} style={{ fontWeight: weight, visibility: 'hidden' }}>
            {hid}
          </span>
        )
      }
    }
    offset = end
  }
  // Caret rests at the end of the last block; the peer stays present.
  if (isLast && !didPlace) {
    nodes.push(<Caret key='end-caret' who={AGENT} />)
    didPlace = true
  }
  return { nodes, placed: didPlace }
}

function AgentDoc({ revealed }: { revealed: number }) {
  const out: React.ReactNode[] = []
  let list: React.ReactNode[] = []
  let offset = 0
  let placed = false

  const flushList = () => {
    if (list.length === 0) return
    out.push(
      <ul
        key={`ul-${out.length}`}
        style={{ margin: '0.6em 0 0', paddingLeft: '1.25em', listStyle: 'disc' }}
      >
        {list}
      </ul>
    )
    list = []
  }

  for (let bi = 0; bi < AGENT_BLOCKS.length; bi++) {
    const block = AGENT_BLOCKS[bi]
    const blockStart = offset
    const res = renderBlockNodes(
      block,
      blockStart,
      revealed,
      placed,
      bi === AGENT_BLOCKS.length - 1
    )
    placed = res.placed
    offset = blockStart + block.segs.reduce((m, s) => m + segText(s).length, 0)

    if (block.kind === 'li') {
      // visibility:hidden on the text still leaves the <li> marker showing, so hide the whole item
      // until the caret reaches it. Hidden items still reserve height, so the card never resizes.
      list.push(
        <li
          key={`li-${bi}`}
          style={{ marginTop: 0, visibility: revealed >= blockStart ? 'visible' : 'hidden' }}
        >
          {res.nodes}
        </li>
      )
    } else {
      flushList()
      out.push(
        <p key={`p-${bi}`} style={{ margin: '0.6em 0 0' }}>
          {res.nodes}
        </p>
      )
    }
  }
  flushList()

  return <>{out}</>
}

function Avatar({ who, overlap }: { who: typeof HUMAN; overlap: boolean }) {
  return (
    <span
      title={who.name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        marginLeft: overlap ? '-6px' : 0,
        borderRadius: '999px',
        background: who.color,
        color: '#fff',
        fontFamily: FONT_SANS,
        fontSize: '8px',
        fontWeight: 600,
        border: '2px solid var(--bg)',
      }}
    >
      {who.name[0]}
    </span>
  )
}

export function AgentPeerDemo() {
  // Initial state (SSR / no-JS / reduced-motion) is the finished document; streaming resets it on scroll-in.
  const [humanN, setHumanN] = useState(HUMAN_TOTAL)
  const [agentN, setAgentN] = useState(AGENT_TOTAL)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const el = cardRef.current
    // No IntersectionObserver / no element / reduced motion: keep the finished document, never clear it.
    if (reduce || !el || typeof IntersectionObserver === 'undefined') return

    let raf = 0
    let played = false
    let cancelled = false

    const play = () => {
      // Clear to empty only once on-screen, so the doc is never left blank if the observer never fires.
      setHumanN(0)
      setAgentN(0)
      const start = performance.now()
      // Frames fire ~16ms but chars land every ~30-60ms; only setState when a count actually changes,
      // so React re-renders ~once per character instead of every frame.
      let lastH = 0
      let lastA = 0
      const tick = (now: number) => {
        if (cancelled) return // cleanup ran (unmount / Strict Mode re-run); stop rescheduling
        const t = now - start
        if (t >= RUN_MS) {
          if (lastH !== HUMAN_TOTAL) setHumanN(HUMAN_TOTAL)
          if (lastA !== AGENT_TOTAL) setAgentN(AGENT_TOTAL)
          return // rest on the finished document; no loop
        }
        const h = countReached(HUMAN_TIMES, t)
        const a = countReached(AGENT_TIMES, t)
        if (h !== lastH) {
          setHumanN(h)
          lastH = h
        }
        if (a !== lastA) {
          setAgentN(a)
          lastA = a
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !played) {
          played = true
          io.disconnect()
          play()
        }
      },
      { threshold: 0.4 }
    )
    io.observe(el)

    return () => {
      cancelled = true
      io.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div style={{ margin: '32px 0', WebkitFontSmoothing: 'antialiased' } as React.CSSProperties}>
      <div
        ref={cardRef}
        style={{
          maxWidth: '560px',
          margin: '0 auto',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        {/* header: filename + presence, mirroring Resource.Header. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            minHeight: '48px',
            padding: '0 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='var(--text-icon)'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden='true'
            >
              <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
              <path d='M14 2v6h6' />
              <path d='M16 13H8M16 17H8M10 9H8' />
            </svg>
            <span
              style={{
                fontFamily: FONT_SANS,
                fontSize: '14px',
                color: 'var(--text-body)',
                whiteSpace: 'nowrap',
              }}
            >
              launch-notes.md
            </span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Avatar who={AGENT} overlap={false} />
            <Avatar who={HUMAN} overlap />
          </span>
        </div>

        {/* document body: the real prose scale (see proseStyle). */}
        <div style={{ ...proseStyle, padding: '18px 22px 22px' }}>
          <div
            style={{
              margin: 0,
              fontSize: '1.6em',
              fontWeight: 600,
              lineHeight: 1.3,
              color: 'var(--text-primary)',
            }}
          >
            Launch notes
          </div>

          <p style={{ margin: '0.6em 0 0' }}>
            {HUMAN_BASE}
            <span>{HUMAN_ADD.slice(0, humanN)}</span>
            <Caret who={HUMAN} />
            <span style={{ visibility: 'hidden' }}>{HUMAN_ADD.slice(humanN)}</span>
          </p>

          <AgentDoc revealed={agentN} />
        </div>
      </div>

      <div
        style={{
          maxWidth: '560px',
          margin: '10px auto 0',
          textAlign: 'center',
          fontFamily: FONT_SANS,
          fontSize: '13px',
          color: 'var(--text-muted)',
        }}
      >
        Sim and a teammate editing the same file at once. Neither one overwrites the other.
      </div>
    </div>
  )
}
