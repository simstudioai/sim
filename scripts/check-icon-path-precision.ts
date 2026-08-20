#!/usr/bin/env bun
/**
 * Prevents newly introduced overly precise numeric values in literal SVG icon
 * `d` attributes.
 *
 * Two decimal places are enough for the reusable icons covered here: additional
 * digits increase shipped source without a visible benefit. Paths already in the
 * target branch are grandfathered by exact content, while new paths and edits to
 * old paths must satisfy the limit or carry a reasoned local exception.
 *
 * Scope is intentionally limited to the shared app/docs icon catalogs and EMCN
 * icon components. SVG transforms, view boxes, dynamic path expressions, and
 * page-specific artwork are not inspected because their safe precision depends
 * on context.
 *
 * Run against the intended merge target: `bun run check:icon-path-precision staging`
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EMCN_ICONS_DIRECTORY = path.join(ROOT, 'packages/emcn/src/icons')
const STATIC_ICON_FILES = [
  path.join(ROOT, 'apps/docs/components/icons.tsx'),
  path.join(ROOT, 'apps/sim/components/icons.tsx'),
]
const STATIC_ICON_PATHS = STATIC_ICON_FILES.map((file) => normalizedRelativePath(file))
const SVG_NUMBER_PATTERN = /[+-]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][+-]?\d+)?/g
const PRECISION_EXCEPTION_DIRECTIVE = 'svg-path-precision-exception:'

export const MAX_ICON_PATH_FRACTION_DIGITS = 2

interface ParsedPrecisionException {
  line: number
  reason: string | null
}

interface LiteralPath {
  exception: ParsedPrecisionException | null
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

export interface InvalidPrecisionException {
  file: string
  line: number
  message: string
}

export interface IconPrecisionAnalysis {
  candidates: PrecisionCandidate[]
  invalidExceptions: InvalidPrecisionException[]
}

interface ExtractedPaths {
  paths: LiteralPath[]
  invalidExceptions: Omit<InvalidPrecisionException, 'file'>[]
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

function nodeLine(node: Record<string, unknown>): number {
  const location = asRecord(node.loc)
  const start = asRecord(location?.start)
  return typeof start?.line === 'number' ? start.line : 1
}

function jsxElementName(node: Record<string, unknown>): string | null {
  const openingElement = asRecord(node.openingElement)
  const name = asRecord(openingElement?.name)
  return name?.type === 'JSXIdentifier' && typeof name.name === 'string' ? name.name : null
}

function normalizedComment(comment: Record<string, unknown>): string {
  if (typeof comment.value !== 'string') return ''
  return comment.value
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
}

function precisionExceptionFromChild(
  child: Record<string, unknown>,
  source: string
): ParsedPrecisionException | null {
  if (child.type !== 'JSXExpressionContainer') return null
  const expression = asRecord(child.expression)
  if (expression?.type !== 'JSXEmptyExpression') return null
  const comments = expression.innerComments
  if (!Array.isArray(comments)) return null

  for (const value of comments) {
    const comment = asRecord(value)
    if (!comment) continue
    const start = typeof comment.start === 'number' ? comment.start : -1
    const end = typeof comment.end === 'number' ? comment.end : -1
    if (start < 0 || end < 0 || !source.slice(start, end).startsWith('/**')) continue
    const text = normalizedComment(comment)
    if (!text.startsWith(PRECISION_EXCEPTION_DIRECTIVE)) continue
    const reason = text.slice(PRECISION_EXCEPTION_DIRECTIVE.length).trim()
    return { line: nodeLine(comment), reason: reason || null }
  }
  return null
}

function extractLiteralPaths(source: string, file: string): ExtractedPaths {
  const syntaxTree = parse(source, {
    sourceFilename: file,
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  const paths: LiteralPath[] = []
  const invalidExceptions: Omit<InvalidPrecisionException, 'file'>[] = []

  function invalidate(exception: ParsedPrecisionException, message: string): void {
    invalidExceptions.push({ line: exception.line, message })
  }

  function visitChildren(children: unknown): void {
    if (!Array.isArray(children)) return
    let pendingException: ParsedPrecisionException | null = null

    for (const value of children) {
      const child = asRecord(value)
      if (!child) continue
      if (child.type === 'JSXText' && typeof child.value === 'string' && !child.value.trim())
        continue

      const exception = precisionExceptionFromChild(child, source)
      if (exception) {
        if (pendingException) {
          invalidate(pendingException, 'Exception must immediately precede one literal <path>.')
        }
        pendingException = exception
        continue
      }

      if (pendingException && (child.type !== 'JSXElement' || jsxElementName(child) !== 'path')) {
        invalidate(pendingException, 'Exception must immediately precede one literal <path>.')
        pendingException = null
      }
      visit(child, pendingException)
      pendingException = null
    }

    if (pendingException) {
      invalidate(pendingException, 'Exception must immediately precede one literal <path>.')
    }
  }

  function visit(value: unknown, exception: ParsedPrecisionException | null = null): void {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    const node = asRecord(value)
    if (!node) return

    if (node.type === 'JSXElement') {
      const openingElement = asRecord(node.openingElement)
      if (jsxElementName(node) === 'path' && openingElement) {
        const attributes = openingElement.attributes
        const dAttribute = Array.isArray(attributes)
          ? attributes.map(asRecord).find((attribute) => {
              const name = asRecord(attribute?.name)
              return name?.type === 'JSXIdentifier' && name.name === 'd'
            })
          : null
        const pathValue = dAttribute ? jsxStringValue(dAttribute) : null
        if (pathValue !== null) {
          const start = typeof openingElement.start === 'number' ? openingElement.start : 0
          paths.push({
            exception,
            icon: iconNameAt(source, start),
            line: nodeLine(dAttribute ?? openingElement),
            value: pathValue,
          })
        } else if (exception) {
          invalidate(exception, 'Exception applies only to a literal <path d> value.')
        }
      } else if (exception) {
        invalidate(exception, 'Exception must immediately precede one literal <path>.')
      }
      visitChildren(node.children)
      return
    }

    if (node.type === 'JSXFragment') {
      if (exception) {
        invalidate(exception, 'Exception must immediately precede one literal <path>.')
      }
      visitChildren(node.children)
      return
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
      visit(child)
    }
  }

  visit(syntaxTree)
  return { paths, invalidExceptions }
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

export function analyzeIconSource(source: string, file: string): IconPrecisionAnalysis {
  const extracted = extractLiteralPaths(source, file)
  const candidates: PrecisionCandidate[] = []
  const normalizedFile = normalizedRelativePath(file)
  const invalidExceptions = extracted.invalidExceptions.map((exception) => ({
    ...exception,
    file: normalizedFile,
  }))

  for (const literalPath of extracted.paths) {
    const preciseNumbers = [...literalPath.value.matchAll(SVG_NUMBER_PATTERN)]
      .map((match) => match[0])
      .filter(
        (numberLiteral) => effectiveFractionDigits(numberLiteral) > MAX_ICON_PATH_FRACTION_DIGITS
      )

    if (literalPath.exception) {
      if (!literalPath.exception.reason) {
        invalidExceptions.push({
          file: normalizedFile,
          line: literalPath.exception.line,
          message: 'Exception must include a specific reason after the colon.',
        })
      } else if (preciseNumbers.length === 0) {
        invalidExceptions.push({
          file: normalizedFile,
          line: literalPath.exception.line,
          message: 'Exception is unnecessary because this path uses at most two decimal places.',
        })
      } else {
        continue
      }
    }

    if (preciseNumbers.length === 0) continue
    candidates.push({
      file: normalizedFile,
      icon: literalPath.icon,
      line: literalPath.line,
      pathHash: hashPath(literalPath.value),
      maxFractionDigits: Math.max(...preciseNumbers.map(effectiveFractionDigits)),
      offendingNumbers: [...new Set(preciseNumbers)].slice(0, 4),
    })
  }

  return { candidates, invalidExceptions }
}

export function findPrecisionCandidates(source: string, file: string): PrecisionCandidate[] {
  return analyzeIconSource(source, file).candidates
}

export function findNewPrecisionCandidates(
  current: PrecisionCandidate[],
  base: PrecisionCandidate[]
): PrecisionCandidate[] {
  const allowedCounts = new Map<string, number>()
  for (const candidate of base) {
    allowedCounts.set(candidate.pathHash, (allowedCounts.get(candidate.pathHash) ?? 0) + 1)
  }

  const seenCounts = new Map<string, number>()
  return current.filter((candidate) => {
    const seen = (seenCounts.get(candidate.pathHash) ?? 0) + 1
    seenCounts.set(candidate.pathHash, seen)
    return seen > (allowedCounts.get(candidate.pathHash) ?? 0)
  })
}

async function currentIconFiles(): Promise<string[]> {
  const emcnIcons = (await readdir(EMCN_ICONS_DIRECTORY))
    .filter((file) => file.endsWith('.tsx'))
    .sort()
    .map((file) => path.join(EMCN_ICONS_DIRECTORY, file))
  return [...STATIC_ICON_FILES, ...emcnIcons]
}

function gitOutput(arguments_: string[]): string {
  const result = Bun.spawnSync(['git', ...arguments_], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    const error = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`git ${arguments_.join(' ')} failed: ${error}`)
  }
  return new TextDecoder().decode(result.stdout)
}

function baseIconPaths(baseCommit: string): string[] {
  const output = gitOutput([
    'ls-tree',
    '-r',
    '--name-only',
    baseCommit,
    '--',
    ...STATIC_ICON_PATHS,
    'packages/emcn/src/icons',
  ])
  return output
    .split('\n')
    .filter(
      (file) =>
        STATIC_ICON_PATHS.includes(file) || /^packages\/emcn\/src\/icons\/.*\.tsx$/.test(file)
    )
}

async function scanCurrentFiles(files: string[]): Promise<IconPrecisionAnalysis> {
  const candidates: PrecisionCandidate[] = []
  const invalidExceptions: InvalidPrecisionException[] = []
  for (const file of files) {
    const analysis = analyzeIconSource(await readFile(file, 'utf8'), file)
    candidates.push(...analysis.candidates)
    invalidExceptions.push(...analysis.invalidExceptions)
  }
  return { candidates, invalidExceptions }
}

function scanBaseFiles(baseCommit: string, files: string[]): PrecisionCandidate[] {
  const candidates: PrecisionCandidate[] = []
  for (const file of files) {
    const source = gitOutput(['show', `${baseCommit}:${file}`])
    candidates.push(...findPrecisionCandidates(source, path.join(ROOT, file)))
  }
  return candidates
}

function printCandidate(candidate: PrecisionCandidate): void {
  console.error(
    `  ${candidate.file}:${candidate.line} (${candidate.icon}) — ${candidate.maxFractionDigits} fractional digits`
  )
  console.error(`    values: ${candidate.offendingNumbers.join(', ')}`)
}

async function main(): Promise<void> {
  const [baseRef, ...unknownArguments] = process.argv.slice(2)
  if (!baseRef || unknownArguments.length > 0 || baseRef.startsWith('-')) {
    console.error('Usage: bun run check:icon-path-precision <base-ref>')
    console.error('Example: bun run check:icon-path-precision staging')
    process.exit(1)
  }

  const baseCommit = gitOutput(['rev-parse', '--verify', `${baseRef}^{commit}`]).trim()
  const files = await currentIconFiles()
  const current = await scanCurrentFiles(files)
  const baseCandidates = scanBaseFiles(baseCommit, baseIconPaths(baseCommit))
  const newCandidates = findNewPrecisionCandidates(current.candidates, baseCandidates)

  if (current.invalidExceptions.length > 0) {
    console.error(
      `\nFound ${current.invalidExceptions.length} invalid SVG precision exception(s):\n`
    )
    for (const exception of current.invalidExceptions) {
      console.error(`  ${exception.file}:${exception.line} — ${exception.message}`)
    }
  }

  if (newCandidates.length > 0) {
    console.error(
      `\nFound ${newCandidates.length} new or changed icon path(s) with more than ${MAX_ICON_PATH_FRACTION_DIGITS} fractional digits compared with ${baseRef}:\n`
    )
    for (const candidate of newCandidates) printCandidate(candidate)
    console.error(
      '\nRound only numeric values inside the literal d attribute to at most two decimal places.'
    )
    console.error(
      'If extra precision is visibly necessary, place this reasoned exception immediately before that path:'
    )
    console.error(`{/**
 * ${PRECISION_EXCEPTION_DIRECTIVE} Explain why rounding changes this geometry.
 */}`)
    console.error(
      'Do not round transform or viewBox values automatically; verify those geometry changes separately.'
    )
  }

  if (current.invalidExceptions.length > 0 || newCandidates.length > 0) {
    process.exit(1)
  }

  console.log(
    `✓ No new overly precise icon paths compared with ${baseRef} (${files.length} current icon files checked).`
  )
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
