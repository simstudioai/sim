#!/usr/bin/env bun
/**
 * Prevents new overly precise numeric values in literal SVG icon `d` attributes.
 *
 * Two decimal places are enough for the reusable icons covered here: additional
 * digits increase shipped source without a visible benefit. Existing legacy
 * paths are recorded by exact content hash, so they may remain unchanged while
 * new paths and edits to old paths must satisfy the limit.
 *
 * Scope is intentionally limited to the shared app/docs icon catalogs and EMCN
 * icon components. SVG transforms, view boxes, dynamic path expressions, and
 * page-specific artwork are not inspected because their safe precision depends
 * on context.
 *
 * Run: `bun run check:icon-path-precision`
 * Update reviewed legacy debt: `bun run scripts/check-icon-path-precision.ts --update-baseline`
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = path.join(ROOT, 'scripts/check-icon-path-precision.baseline.json')
const EMCN_ICONS_DIRECTORY = path.join(ROOT, 'packages/emcn/src/icons')
const STATIC_ICON_FILES = [
  path.join(ROOT, 'apps/docs/components/icons.tsx'),
  path.join(ROOT, 'apps/sim/components/icons.tsx'),
]
const SVG_NUMBER_PATTERN = /[+-]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][+-]?\d+)?/g

export const MAX_ICON_PATH_FRACTION_DIGITS = 2

interface LiteralPath {
  icon: string
  line: number
  value: string
}

export interface PrecisionCandidate {
  file: string
  icon: string
  line: number
  pathHash: string
  maxFractionDigits: number
  offendingNumbers: string[]
}

export interface PrecisionBaseline {
  generatedFrom: string
  maxFractionDigits: number
  entries: Record<string, number>
}

export interface PrecisionComparison {
  unbaselined: PrecisionCandidate[]
  staleBaseline: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function jsxStringValue(attribute: Record<string, unknown>): string | null {
  const value = asRecord(attribute.value)
  if (!value) return null
  if (value.type === 'StringLiteral' && typeof value.value === 'string') return value.value
  if (value.type !== 'JSXExpressionContainer') return null

  const expression = asRecord(value.expression)
  if (!expression) return null
  if (expression.type === 'StringLiteral' && typeof expression.value === 'string') {
    return expression.value
  }
  if (expression.type !== 'TemplateLiteral') return null

  const expressions = expression.expressions
  const quasis = expression.quasis
  if (!Array.isArray(expressions) || expressions.length > 0 || !Array.isArray(quasis)) return null
  const quasi = asRecord(quasis[0])
  const quasiValue = asRecord(quasi?.value)
  if (!quasiValue) return null
  if (typeof quasiValue.cooked === 'string') return quasiValue.cooked
  return typeof quasiValue.raw === 'string' ? quasiValue.raw : null
}

function iconNameAt(source: string, offset: number): string {
  const before = source.slice(0, offset)
  const matches = [...before.matchAll(/export (?:function|const) (\w+)\s*[=(]/g)]
  return matches.length > 0 ? matches[matches.length - 1][1] : '<unknown>'
}

export function extractLiteralPaths(source: string, file: string): LiteralPath[] {
  const syntaxTree = parse(source, {
    sourceFilename: file,
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  const paths: LiteralPath[] = []

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    const node = asRecord(value)
    if (!node) return

    if (node.type === 'JSXAttribute') {
      const name = asRecord(node.name)
      if (name?.type === 'JSXIdentifier' && name.name === 'd') {
        const pathValue = jsxStringValue(node)
        if (pathValue !== null) {
          const start = typeof node.start === 'number' ? node.start : 0
          const location = asRecord(node.loc)
          const locationStart = asRecord(location?.start)
          paths.push({
            icon: iconNameAt(source, start),
            line: typeof locationStart?.line === 'number' ? locationStart.line : 1,
            value: pathValue,
          })
        }
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
      visit(child)
    }
  }

  visit(syntaxTree)
  return paths
}

/**
 * Counts both digits written after the decimal point and precision introduced
 * by a negative exponent. This catches values such as `1.234` and `1e-3`.
 */
export function effectiveFractionDigits(numberLiteral: string): number {
  const [mantissa, exponentText] = numberLiteral.toLowerCase().split('e')
  const decimalIndex = mantissa.indexOf('.')
  const writtenFractionDigits = decimalIndex < 0 ? 0 : mantissa.length - decimalIndex - 1
  const exponent = exponentText === undefined ? 0 : Number.parseInt(exponentText, 10)
  const exponentFractionDigits = Math.max(0, writtenFractionDigits - exponent)
  return Math.max(writtenFractionDigits, exponentFractionDigits)
}

function hashPath(pathValue: string): string {
  return createHash('sha256').update(pathValue).digest('hex')
}

function normalizedRelativePath(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

export function findPrecisionCandidates(source: string, file: string): PrecisionCandidate[] {
  const candidates: PrecisionCandidate[] = []
  for (const literalPath of extractLiteralPaths(source, file)) {
    const preciseNumbers = [...literalPath.value.matchAll(SVG_NUMBER_PATTERN)]
      .map((match) => match[0])
      .filter(
        (numberLiteral) => effectiveFractionDigits(numberLiteral) > MAX_ICON_PATH_FRACTION_DIGITS
      )
    if (preciseNumbers.length === 0) continue

    candidates.push({
      file: normalizedRelativePath(file),
      icon: literalPath.icon,
      line: literalPath.line,
      pathHash: hashPath(literalPath.value),
      maxFractionDigits: Math.max(...preciseNumbers.map(effectiveFractionDigits)),
      offendingNumbers: [...new Set(preciseNumbers)].slice(0, 4),
    })
  }
  return candidates
}

function baselineKey(entry: Pick<PrecisionCandidate, 'pathHash'>): string {
  return entry.pathHash
}

export function createPrecisionBaseline(candidates: PrecisionCandidate[]): PrecisionBaseline {
  const grouped = new Map<string, number>()
  for (const candidate of candidates) {
    const key = baselineKey(candidate)
    grouped.set(key, (grouped.get(key) ?? 0) + 1)
  }

  return {
    generatedFrom: 'shared app/docs icon catalogs and packages/emcn/src/icons',
    maxFractionDigits: MAX_ICON_PATH_FRACTION_DIGITS,
    entries: Object.fromEntries(
      [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
  }
}

export function comparePrecisionBaseline(
  candidates: PrecisionCandidate[],
  baseline: PrecisionBaseline
): PrecisionComparison {
  const allowedCounts = new Map(Object.entries(baseline.entries))
  const seenCounts = new Map<string, number>()
  const unbaselined: PrecisionCandidate[] = []

  for (const candidate of candidates) {
    const key = baselineKey(candidate)
    const seen = (seenCounts.get(key) ?? 0) + 1
    seenCounts.set(key, seen)
    if (seen > (allowedCounts.get(key) ?? 0)) unbaselined.push(candidate)
  }

  const staleBaseline = Object.entries(baseline.entries)
    .filter(([key, occurrences]) => (seenCounts.get(key) ?? 0) < occurrences)
    .map(([key]) => key)
  return { unbaselined, staleBaseline }
}

async function defaultIconFiles(): Promise<string[]> {
  const emcnIcons = (await readdir(EMCN_ICONS_DIRECTORY))
    .filter((file) => file.endsWith('.tsx'))
    .sort()
    .map((file) => path.join(EMCN_ICONS_DIRECTORY, file))
  return [...STATIC_ICON_FILES, ...emcnIcons]
}

async function scanFiles(files: string[]): Promise<PrecisionCandidate[]> {
  const candidates: PrecisionCandidate[] = []
  for (const file of files) {
    candidates.push(...findPrecisionCandidates(await readFile(file, 'utf8'), file))
  }
  return candidates
}

async function loadBaseline(): Promise<PrecisionBaseline> {
  return JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as PrecisionBaseline
}

function printCandidate(candidate: PrecisionCandidate): void {
  console.error(
    `  ${candidate.file}:${candidate.line} (${candidate.icon}) — ${candidate.maxFractionDigits} fractional digits`
  )
  console.error(`    values: ${candidate.offendingNumbers.join(', ')}`)
}

async function main(): Promise<void> {
  const updateBaseline = process.argv.includes('--update-baseline')
  const unknownArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== '--update-baseline')
  if (unknownArguments.length > 0) {
    console.error(`Unknown argument(s): ${unknownArguments.join(', ')}`)
    process.exit(1)
  }

  const files = await defaultIconFiles()
  const candidates = await scanFiles(files)
  if (updateBaseline) {
    const baseline = createPrecisionBaseline(candidates)
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(
      `✓ Wrote ${Object.keys(baseline.entries).length} exact legacy icon path fingerprint(s) to ${path.relative(ROOT, BASELINE_PATH)}.`
    )
    return
  }

  const baseline = await loadBaseline()
  if (baseline.maxFractionDigits !== MAX_ICON_PATH_FRACTION_DIGITS) {
    console.error(
      `Icon path precision baseline uses ${baseline.maxFractionDigits} digits; checker expects ${MAX_ICON_PATH_FRACTION_DIGITS}.`
    )
    process.exit(1)
  }

  const comparison = comparePrecisionBaseline(candidates, baseline)
  if (comparison.unbaselined.length > 0) {
    console.error(
      `\nFound ${comparison.unbaselined.length} new or changed icon path(s) with more than ${MAX_ICON_PATH_FRACTION_DIGITS} fractional digits:\n`
    )
    for (const candidate of comparison.unbaselined) printCandidate(candidate)
    console.error(
      '\nRound only numeric values inside the literal d attribute to at most two decimal places.'
    )
    console.error(
      'Do not round transform or viewBox values automatically; verify those geometry changes separately.'
    )
  }

  if (comparison.staleBaseline.length > 0) {
    console.error(
      `\nThe icon path precision baseline has ${comparison.staleBaseline.length} stale entr${comparison.staleBaseline.length === 1 ? 'y' : 'ies'}.`
    )
    console.error(
      'After confirming the legacy path was removed, rounded, or intentionally changed, regenerate the baseline with:'
    )
    console.error('  bun run scripts/check-icon-path-precision.ts --update-baseline\n')
  }

  if (comparison.unbaselined.length > 0 || comparison.staleBaseline.length > 0) {
    process.exit(1)
  }

  console.log(
    `✓ No new overly precise icon paths (${files.length} files; ${Object.keys(baseline.entries).length} exact legacy path fingerprints ratcheted).`
  )
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
