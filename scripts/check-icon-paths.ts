#!/usr/bin/env bun
/**
 * Validates that every `<path d='…'>` in `apps/sim/components/icons.tsx` is
 * syntactically well-formed SVG path data.
 *
 * Malformed path data does not crash the build or fail TypeScript — the browser
 * silently drops the bad segment and logs `<path> attribute d: Expected number`
 * / `Expected arc flag` to the console. A bulk icon reformat once corrupted
 * several brand icons this way (dropped arc-flag digits, mangled cubic operands
 * like `c00,00,00`), flooding the integrations page with dozens of console
 * errors that no existing check caught. This script is that missing gate.
 *
 * It walks each `d` string against the SVG path grammar and fails if any
 * command has the wrong operand count or an arc flag that is not `0`/`1`.
 * Number scanning handles the compact forms the spec allows (packed decimals
 * `.5.5`, sign-delimited `1-2`, exponents, and arc flags packed against
 * neighbours like `001.39`), so valid minified paths pass unflagged.
 *
 * Run: `bun run scripts/check-icon-paths.ts`
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
/** Defaults to the shared icon module; overridable via argv for testing. */
const ICONS_FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'apps/sim/components/icons.tsx')

/** Operand count per path command; arc (`a`) is handled specially for flags. */
const OPERANDS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
}

const isWsp = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'

/** Skip whitespace and comma separators; returns the next significant index. */
function skipSep(d: string, i: number): number {
  while (i < d.length && (isWsp(d[i]) || d[i] === ',')) i++
  return i
}

/**
 * Scan one number starting at `i` (after separators are skipped). Returns the
 * index past the number, or `-1` if no valid number begins here. Mirrors the
 * SVG number grammar: optional sign, integer/fraction, optional exponent.
 */
function scanNumber(d: string, i: number): number {
  const start = i
  if (d[i] === '+' || d[i] === '-') i++
  let digits = 0
  while (i < d.length && d[i] >= '0' && d[i] <= '9') {
    i++
    digits++
  }
  if (d[i] === '.') {
    i++
    while (i < d.length && d[i] >= '0' && d[i] <= '9') {
      i++
      digits++
    }
  }
  if (digits === 0) return -1
  if (d[i] === 'e' || d[i] === 'E') {
    let j = i + 1
    if (d[j] === '+' || d[j] === '-') j++
    let expDigits = 0
    while (j < d.length && d[j] >= '0' && d[j] <= '9') {
      j++
      expDigits++
    }
    if (expDigits > 0) i = j
  }
  return i > start ? i : -1
}

interface PathError {
  reason: string
  /** 0-based offset into the `d` string where parsing failed. */
  offset: number
}

/**
 * Validate a single `d` string. Returns the first structural error, or `null`
 * when the path is well-formed.
 */
function validatePath(d: string): PathError | null {
  let i = skipSep(d, 0)
  if (i >= d.length) return { reason: 'empty path data', offset: 0 }

  let cmd = ''
  // The first command must be a moveto.
  if (d[i] !== 'M' && d[i] !== 'm') return { reason: 'path must start with M/m', offset: i }

  while (i < d.length) {
    i = skipSep(d, i)
    if (i >= d.length) break

    const ch = d[i]
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toLowerCase() in OPERANDS)) {
        return { reason: `unknown command '${ch}'`, offset: i }
      }
      cmd = ch
      i++
      if (cmd === 'z' || cmd === 'Z') continue
    } else if (cmd === '' || cmd === 'z' || cmd === 'Z') {
      return { reason: `expected a command, found '${ch}'`, offset: i }
    }

    // After an explicit M/m, repeated operand groups are implicit L/l.
    const effective = cmd === 'M' ? 'L' : cmd === 'm' ? 'l' : cmd
    const key = effective.toLowerCase()

    if (key === 'a') {
      const err = scanArcGroup(d, i)
      if (typeof err === 'string') return { reason: err, offset: i }
      i = err
    } else {
      const count = OPERANDS[key]
      for (let n = 0; n < count; n++) {
        const before = skipSep(d, i)
        const next = scanNumber(d, before)
        if (next < 0) {
          return { reason: `expected number for '${cmd}' command`, offset: before }
        }
        i = next
      }
    }
  }
  return null
}

/**
 * Scan one 7-operand arc group: rx ry x-axis-rotation large-arc-flag
 * sweep-flag x y. Flags are a single `0`/`1` that may be packed against the
 * next token (e.g. `001.39`). Returns the next index, or an error string.
 */
function scanArcGroup(d: string, i: number): number | string {
  for (let n = 0; n < 3; n++) {
    const before = skipSep(d, i)
    const next = scanNumber(d, before)
    if (next < 0) return `expected number in arc command`
    i = next
  }
  for (let n = 0; n < 2; n++) {
    const before = skipSep(d, i)
    if (d[before] !== '0' && d[before] !== '1') {
      return `expected arc flag ('0' or '1')`
    }
    i = before + 1
  }
  for (let n = 0; n < 2; n++) {
    const before = skipSep(d, i)
    const next = scanNumber(d, before)
    if (next < 0) return `expected number in arc command`
    i = next
  }
  return i
}

interface Finding {
  icon: string
  line: number
  reason: string
  snippet: string
}

/**
 * Find the nearest preceding icon export for a source offset. Matches both
 * `export function XxxIcon` and `export const XxxIcon =` forms so arrow-function
 * icons are attributed correctly.
 */
function iconNameAt(src: string, offset: number): string {
  const before = src.slice(0, offset)
  const matches = [...before.matchAll(/export (?:function|const) (\w+)\s*[=(]/g)]
  return matches.length ? matches[matches.length - 1][1] : '<unknown>'
}

async function main() {
  const src = await readFile(ICONS_FILE, 'utf8')
  const findings: Finding[] = []

  for (const m of src.matchAll(/\bd=(?:'([^']*)'|"([^"]*)")/g)) {
    const d = m[1] ?? m[2] ?? ''
    if (!d.trim()) continue
    const err = validatePath(d)
    if (!err) continue

    // Offset of the `d` value within the file → the corrupt char.
    const valueStart = m.index + m[0].indexOf(d)
    const fileOffset = valueStart + err.offset
    const line = src.slice(0, fileOffset).split('\n').length
    const around = d.slice(Math.max(0, err.offset - 20), err.offset + 20)
    findings.push({
      icon: iconNameAt(src, m.index),
      line,
      reason: err.reason,
      snippet: `…${around}…`,
    })
  }

  if (findings.length === 0) {
    console.log('✓ All icon <path> data in components/icons.tsx is valid SVG.')
    process.exit(0)
  }

  console.error(`\nFound ${findings.length} malformed icon path(s) in components/icons.tsx:\n`)
  for (const f of findings) {
    console.error(`  ${f.icon} (icons.tsx:${f.line}) — ${f.reason}`)
    console.error(`    near: ${f.snippet}`)
    console.error(
      '    Malformed path data renders nothing and floods the console with SVG parse errors.'
    )
    console.error('    Fix the d attribute (correct operand counts; arc flags must be 0 or 1).\n')
  }
  process.exit(1)
}

main()
