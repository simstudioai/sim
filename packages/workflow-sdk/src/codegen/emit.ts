/**
 * Small, deterministic text helpers for the `.d.ts` emitter: JSDoc and literal unions. Output
 * follows the repo style (2 spaces, no semicolons); strings and property keys are quoted by
 * `@sim/workflow-code`'s `quoteString` and `printKey`, as printed source is.
 */

import { quoteString } from '@sim/workflow-code'

/** A TS literal type for an option id. */
export function literal(value: string | number | boolean): string {
  return typeof value === 'string' ? quoteString(value) : String(value)
}

/** A union of distinct members, in first-seen order. */
export function union(members: readonly string[]): string {
  const distinct: string[] = []
  for (const member of members) if (!distinct.includes(member)) distinct.push(member)
  return distinct.length === 0 ? 'never' : distinct.join(' | ')
}

/** The array of `type`: `T[]` for a simple name, else `Array<…>` so a union needs no parentheses. */
export function arrayOf(type: string): string {
  return /^[A-Za-z0-9_.<>]+$/.test(type) ? `${type}[]` : `Array<${type}>`
}

/** `Slack send message` → `SlackSendMessage`. */
export function pascal(parts: readonly string[]): string {
  return parts
    .flatMap((part) => part.split(/[^A-Za-z0-9]+/))
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
}

function sanitizeDoc(line: string): string {
  return line.replace(/\*\//g, '*\\/').replace(/\s+/g, ' ').trim()
}

/** JSDoc lines at `indent`, or nothing when there is nothing to say. */
export function jsdoc(lines: readonly string[], indent: string): string[] {
  const clean = lines.map(sanitizeDoc).filter(Boolean)
  if (clean.length === 0) return []
  if (clean.length === 1) return [`${indent}/** ${clean[0]} */`]
  return [`${indent}/**`, ...clean.map((line) => `${indent} * ${line}`), `${indent} */`]
}

/** Indents every non-empty line. */
export function indentLines(lines: readonly string[], indent: string): string[] {
  return lines.map((line) => (line === '' ? line : `${indent}${line}`))
}
