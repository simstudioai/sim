#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const APP_DIR = path.join(ROOT, 'apps/sim')

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build'])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const STORE_HOOK_CALL_PATTERN = /\buse[A-Z][A-Za-z0-9_]*Store\s*\(/g
const SAFE_ANNOTATION = 'zustand-v5-safe:'
const UNSAFE_SELECTOR_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /=>\s*\(\s*\{/,
    reason: 'selector returns a fresh object literal; wrap it in useShallow',
  },
  {
    pattern: /\breturn\s+\{/,
    reason: 'selector returns a fresh object literal; wrap it in useShallow',
  },
  {
    pattern: /=>\s*\[/,
    reason: 'selector returns a fresh array literal; wrap it in useShallow',
  },
  {
    pattern: /\breturn\s+\[/,
    reason: 'selector returns a fresh array literal; wrap it in useShallow',
  },
  {
    pattern:
      /(?:=>|return)\s+Object\.(?:values|entries)\s*\([^)]*\)(?!\s*\.\s*(?:length|some|every)\b)/,
    reason:
      'selector allocates a derived collection; use useStoreWithEqualityFn or memoize outside',
  },
  {
    pattern: /\bObject\.fromEntries\s*\(/,
    reason: 'selector allocates a derived object; use useStoreWithEqualityFn or memoize outside',
  },
  {
    pattern: /\bObject\.keys\s*\([^)]*\)(?!\s*\.length\b)/,
    reason: 'selector allocates Object.keys; return a primitive or use useShallow',
  },
  {
    pattern: /(?:=>|return)\s+[^;{}]*\.(?:map|filter|reduce)\s*\(/,
    reason: 'selector allocates a derived value; use useStoreWithEqualityFn or memoize outside',
  },
  {
    pattern: /\bnew\s+(?:Set|Map)\s*\(/,
    reason:
      'selector returns a fresh collection; use useStoreWithEqualityFn or a stable store reference',
  },
  {
    pattern: /\?\?\s*(?:\(\s*\)\s*=>|\{\s*\}|\[\s*\])/,
    reason: 'selector uses an unstable fallback reference; move the fallback to module scope',
  },
  {
    pattern: /\|\|\s*(?:\(\s*\)\s*=>|\{\s*\}|\[\s*\])/,
    reason: 'selector uses an unstable fallback reference; move the fallback to module scope',
  },
]

interface Violation {
  file: string
  line: number
  description: string
  snippet: string
}

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue

    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, results)
      continue
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(full)
    }
  }

  return results
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index++
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0) return index
    }
  }

  return -1
}

function splitTopLevelArguments(args: string): string[] {
  const result: string[] = []
  let start = 0
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false

  for (let index = 0; index < args.length; index++) {
    const char = args[index]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--

    if (char === ',' && depth === 0) {
      result.push(args.slice(start, index).trim())
      start = index + 1
    }
  }

  const finalArg = args.slice(start).trim()
  if (finalArg) result.push(finalArg)

  return result
}

function lineNumberAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') line++
  }
  return line
}

function hasSafeAnnotation(source: string, callStart: number): boolean {
  const before = source.slice(0, callStart)
  const lines = before.split('\n')
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    const trimmed = lines[i]?.trim()
    if (!trimmed) continue
    if (trimmed.includes(SAFE_ANNOTATION) && trimmed.split(SAFE_ANNOTATION)[1]?.trim()) {
      return true
    }
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
      return false
    }
  }
  return false
}

function oneLineSnippet(source: string, start: number, end: number): string {
  return source.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 180)
}

function auditFile(file: string, source: string): Violation[] {
  const violations: Violation[] = []
  STORE_HOOK_CALL_PATTERN.lastIndex = 0

  for (
    let match = STORE_HOOK_CALL_PATTERN.exec(source);
    match;
    match = STORE_HOOK_CALL_PATTERN.exec(source)
  ) {
    const callStart = match.index
    const callee = match[0].replace(/\s*\($/, '')
    if (callee === 'useSyncExternalStore') continue

    if (hasSafeAnnotation(source, callStart)) continue

    const openParenIndex = source.indexOf('(', callStart)
    const closeParenIndex = findMatchingParen(source, openParenIndex)
    if (closeParenIndex === -1) continue

    const args = splitTopLevelArguments(source.slice(openParenIndex + 1, closeParenIndex))
    const line = lineNumberAt(source, callStart)
    const snippet = oneLineSnippet(source, callStart, closeParenIndex + 1)

    if (args.length === 0) {
      violations.push({
        file,
        line,
        description: `${callee} subscribes to the entire store; select only the fields needed`,
        snippet,
      })
      continue
    }

    if (args.length > 1) {
      violations.push({
        file,
        line,
        description: `${callee} passes a second equality argument; Zustand v5 create() hooks ignore the v4 pattern. Use useShallow or useStoreWithEqualityFn.`,
        snippet,
      })
      continue
    }

    const selector = args[0]
    if (!selector || selector.startsWith('useShallow(')) continue

    for (const { pattern, reason } of UNSAFE_SELECTOR_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(selector)) {
        if (returnsPrimitiveDerivedValue(selector)) continue
        if (usesReferenceFallbackOnlyInsideBlockBody(selector)) continue
        violations.push({
          file,
          line,
          description: `${callee} ${reason}`,
          snippet,
        })
        break
      }
    }
  }

  return violations
}

function returnsPrimitiveDerivedValue(selector: string): boolean {
  return (
    /\bObject\.(?:keys|values|entries)\s*\([^)]*\)\s*\.\s*(?:length|some|every)\b/.test(selector) ||
    /\bObject\.keys\s*\([^)]*\)\.length\b/.test(selector) ||
    /\.(?:map|filter)\s*\([^)]*\)\s*\.\s*(?:length|some|every|join)\b/.test(selector)
  )
}

function usesReferenceFallbackOnlyInsideBlockBody(selector: string): boolean {
  if (!/\)\s*=>\s*\{/.test(selector)) return false

  const returnExpressions = [...selector.matchAll(/\breturn\s+([^;\n}]+)/g)].map((match) =>
    match[1].trim()
  )

  return (
    returnExpressions.length > 0 &&
    returnExpressions.every((expression) => isPrimitiveReturnExpression(expression, selector))
  )
}

function isPrimitiveReturnExpression(expression: string, selector: string): boolean {
  const normalized = expression
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim()

  if (/^(?:true|false|null|undefined)\b/.test(normalized)) return true
  if (/^(?:['"`]|\d)/.test(normalized)) return true
  if (/^(?:!|typeof\b)/.test(normalized)) return true
  if (/^(?:Boolean|Number|String)\s*\(/.test(normalized)) return true
  if (/(?:===|!==|==|!=|>=|<=|>|<)/.test(normalized)) return true
  if (/\.(?:length|some|every|includes|has)\s*(?:\(|$)/.test(normalized)) return true

  if (/^[A-Za-z_$][\w$]*$/.test(normalized)) {
    return isIdentifierAssignedPrimitive(normalized, selector)
  }

  return false
}

function isIdentifierAssignedPrimitive(identifier: string, selector: string): boolean {
  const declarationPattern = new RegExp(`\\b(?:const|let)\\s+${identifier}\\s*=\\s*([^;\\n]+)`)
  const declaration = selector.match(declarationPattern)
  if (!declaration) return false

  return isPrimitiveReturnExpression(declaration[1], selector)
}

async function main() {
  const files = await walk(APP_DIR)
  const violations: Violation[] = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const relativeFile = path.relative(ROOT, file)
    violations.push(...auditFile(relativeFile, source))
  }

  if (violations.length === 0) {
    console.log('✅ Zustand v5 selector audit OK')
    return
  }

  console.error('❌ Zustand v5 selector hazards found:')
  console.error(
    `Add useShallow/useStoreWithEqualityFn, split into primitive selectors, or document intentional exceptions with // ${SAFE_ANNOTATION} <reason>.`
  )
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} — ${violation.description}\n    ${violation.snippet}`
    )
  }
  process.exit(1)
}

void main().catch((error) => {
  console.error('Zustand v5 selector audit failed:', error)
  process.exit(1)
})
