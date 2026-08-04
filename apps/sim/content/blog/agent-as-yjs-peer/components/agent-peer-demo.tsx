'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A small, self-contained illustration for the post: two peers editing the same document at once.
 * A teammate ("Zoe") extends the top line while the agent ("Sim") writes the bottom line, and
 * neither one overwrites the other. It is a scripted animation, not a live CRDT, but it is faithful
 * to the idea: both carets advance independently and both edits land.
 *
 * Conventions match the other blog demos: 'use client', inline styles, no dependencies. Degrades to
 * the finished document when JavaScript is off or reduced motion is requested.
 */

type Token = string | { code: string }

const HUMAN = { name: 'Zoe', color: '#e0872f' }
const AGENT = { name: 'Sim', color: '#6f5bf0' }

// The top line already exists; the teammate is still appending to it.
const HUMAN_BASE = 'Rollout is set for Friday.'
const HUMAN_ADD = ' Ops signed off this morning.'

// The bottom line is written from empty by the agent, one piece at a time. The code token pops in
// formatted, which is the small detail that sells "it arrives as real, formatted content."
const AGENT_LINE: Token[] = [
  'The p95 latency held at ',
  { code: '180ms' },
  ' through the load test, and errors stayed flat.',
]

const tokenLen = (t: Token) => (typeof t === 'string' ? t.length : t.code.length)
const AGENT_TOTAL = AGENT_LINE.reduce((n, t) => n + tokenLen(t), 0)

const HUMAN_MS = 46 // ms per character
const AGENT_MS = 30
const HOLD_MS = 1900 // pause on the finished document before looping

const codeStyle: React.CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: '0.86em',
  background: '#f1f1f3',
  color: '#2a2a2a',
  border: '1px solid rgba(0,0,0,0.06)',
  borderRadius: '5px',
  padding: '1px 5px',
}

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
        className='apd-caret'
        style={{
          position: 'absolute',
          left: '-1px',
          bottom: '-0.14em',
          width: '2px',
          height: '1.25em',
          borderRadius: '1px',
          background: who.color,
        }}
      />
      {/* Name tag sits to the RIGHT of the caret, on the same line, so it never collides with the
          line above. This is how Google Docs / Figma render a live collaborator's caret. */}
      <span
        style={{
          position: 'absolute',
          left: '4px',
          bottom: '-0.05em',
          padding: '1px 6px',
          borderRadius: '6px',
          background: who.color,
          color: '#fff',
          fontSize: '10.5px',
          fontWeight: 600,
          lineHeight: 1.35,
          whiteSpace: 'nowrap',
          letterSpacing: '0.01em',
          boxShadow: '0 1px 2px rgba(0,0,0,0.16)',
        }}
      >
        {who.name}
      </span>
    </span>
  )
}

function renderAgent(revealed: number) {
  const nodes: React.ReactNode[] = []
  let offset = 0
  let capped = false
  for (let i = 0; i < AGENT_LINE.length; i++) {
    const t = AGENT_LINE[i]
    const len = tokenLen(t)
    if (revealed <= offset) {
      capped = true
      break
    }
    if (typeof t === 'string') {
      const local = Math.min(len, revealed - offset)
      nodes.push(<span key={i}>{t.slice(0, local)}</span>)
      if (local < len) {
        capped = true
        offset += len
        break
      }
    } else {
      nodes.push(
        <code key={i} style={codeStyle}>
          {t.code}
        </code>
      )
      if (revealed < offset + len) {
        capped = true
        offset += len
        break
      }
    }
    offset += len
  }
  return { nodes, done: !capped && revealed >= AGENT_TOTAL }
}

export function AgentPeerDemo() {
  const [humanN, setHumanN] = useState(HUMAN_ADD.length)
  const [agentN, setAgentN] = useState(AGENT_TOTAL)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    let start = performance.now()
    let holdUntil = 0
    setHumanN(0)
    setAgentN(0)

    const tick = (now: number) => {
      if (holdUntil) {
        if (now >= holdUntil) {
          holdUntil = 0
          start = now
          setHumanN(0)
          setAgentN(0)
        }
        raf.current = requestAnimationFrame(tick)
        return
      }
      const elapsed = now - start
      const h = Math.min(HUMAN_ADD.length, Math.floor(elapsed / HUMAN_MS))
      const a = Math.min(AGENT_TOTAL, Math.floor(elapsed / AGENT_MS))
      setHumanN(h)
      setAgentN(a)
      if (h >= HUMAN_ADD.length && a >= AGENT_TOTAL) holdUntil = now + HOLD_MS
      raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [])

  const humanDone = humanN >= HUMAN_ADD.length
  const agent = renderAgent(agentN)

  return (
    <div style={{ margin: '32px 0', WebkitFontSmoothing: 'antialiased' } as React.CSSProperties}>
      <style>{`@keyframes apd-blink{0%,49%{opacity:1}50%,100%{opacity:0}} .apd-caret{animation:apd-blink 1.05s steps(1) infinite}`}</style>
      <div
        style={{
          maxWidth: '540px',
          margin: '0 auto',
          background: '#fff',
          borderRadius: '14px',
          boxShadow:
            '0 0 0 1px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04), 0 8px 28px rgba(0,0,0,0.07)',
          overflow: 'hidden',
        }}
      >
        {/* header: filename + presence */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '11px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <div
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontSize: '12.5px',
              color: '#6b6b6b',
            }}
          >
            launch-notes.md
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {[AGENT, HUMAN].map((p, i) => (
              <span
                key={p.name}
                title={p.name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  marginLeft: i === 0 ? 0 : '-6px',
                  borderRadius: '999px',
                  background: p.color,
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: 700,
                  border: '2px solid #fff',
                }}
              >
                {p.name[0]}
              </span>
            ))}
          </div>
        </div>

        {/* document body */}
        <div
          style={
            {
              padding: '20px 22px 24px',
              fontSize: '15px',
              lineHeight: 1.9,
              color: '#2b2b2b',
              textWrap: 'pretty',
            } as React.CSSProperties
          }
        >
          <div
            style={{ fontSize: '17px', fontWeight: 650, color: '#171717', marginBottom: '10px' }}
          >
            Launch notes
          </div>

          <p style={{ margin: '0 0 14px' }}>
            {HUMAN_BASE}
            {HUMAN_ADD.slice(0, humanN)}
            {!humanDone && <Caret who={HUMAN} />}
          </p>

          <p style={{ margin: 0, minHeight: '1.9em' }}>
            {agent.nodes}
            {!agent.done && <Caret who={AGENT} />}
          </p>
        </div>
      </div>

      <div
        style={{
          maxWidth: '540px',
          margin: '10px auto 0',
          textAlign: 'center',
          fontSize: '13px',
          color: '#8a8a8a',
        }}
      >
        Sim and a teammate editing the same file at once. Neither one overwrites the other.
      </div>
    </div>
  )
}
