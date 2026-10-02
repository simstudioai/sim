/** A lone directive statement, e.g. `'use server'` or `"use client";`. */
const DIRECTIVE_STATEMENT = /^(['"])(use [a-z-]+)\1\s*;?$/

/**
 * The directive a single source line states, e.g. `use client`, or null. A note may follow the
 * directive on the same line, so a trailing `//` or `/* *\/` comment comes off before matching.
 */
export function directiveOn(line: string): string | null {
  const statement = line
    .trim()
    .replace(/(?:\/\/.*|\/\*.*?\*\/)\s*$/, '')
    .trim()
  return DIRECTIVE_STATEMENT.exec(statement)?.[2] ?? null
}

/** Comments and whitespace ahead of a module's first statement. */
const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/

/**
 * The module's leading directive prologue, if any. A directive must be the first statement;
 * comments and blank lines may precede it.
 */
export function leadingDirective(content: string): string | null {
  return directiveOn(content.replace(LEADING_COMMENTS, '').split('\n', 1)[0])
}
