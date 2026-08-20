import ts from '@typescript/typescript6'
import {
  applySourceEdits,
  CodePlaceholderCompileError,
  createCodePlaceholderCompilationContext,
  isOffsetInRanges,
  type SourceEdit,
} from '@/lib/execution/code-placeholders/shared'
import type {
  CodePlaceholderOccurrence,
  CompiledCodePlaceholders,
  InternalCompileCodePlaceholdersInput,
  ResolvedCodePlaceholderOccurrence,
} from '@/lib/execution/code-placeholders/types'

interface SentinelOccurrence {
  occurrence: CodePlaceholderOccurrence
  sentinel: string
}

const SENTINEL_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface DecodedJavaScriptSyntax {
  identifierNames: string[]
  values: string[]
  environmentReads: DirectEnvironmentRead[]
  /** Offset of a `...rest` grab off the environment object, which takes every value at once. */
  environmentRestReadOffset?: number
}

export interface DirectEnvironmentRead {
  name: string
  offset: number
}

/** The runtime identifier the sandbox prologue binds the environment to. */
const ENVIRONMENT_VARIABLES_IDENTIFIER = 'environmentVariables'

/**
 * Names a statically visible read off the runtime environment object, covering
 * `environmentVariables.NAME`, `environmentVariables['NAME']`, and their optional-chained
 * forms. A computed subscript is deliberately not resolved — see
 * {@link CodePlaceholderCompilationContext.recordDirectEnvironmentRead}.
 */
/** Parentheses group; they never change which object an expression evaluates to. */
function unwrapParentheses(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

/** Whether this expression is, after grouping, the bare runtime environment identifier. */
function isEnvironmentReceiver(node: ts.Expression): boolean {
  const unwrapped = unwrapParentheses(node)
  return ts.isIdentifier(unwrapped) && unwrapped.text === ENVIRONMENT_VARIABLES_IDENTIFIER
}

function directEnvironmentRead(node: ts.Node): DirectEnvironmentRead | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    if (!isEnvironmentReceiver(node.expression)) return undefined
    return node.name.text ? { name: node.name.text, offset: node.getStart() } : undefined
  }
  if (ts.isElementAccessExpression(node)) {
    if (!isEnvironmentReceiver(node.expression)) return undefined
    const argument = node.argumentExpression
    if (!ts.isStringLiteralLike(argument) || !argument.text) return undefined
    return { name: argument.text, offset: node.getStart() }
  }
  return undefined
}

interface DestructuredEnvironmentReads {
  reads: DirectEnvironmentRead[]
  restOffset?: number
}

/**
 * Names read off the environment object through destructuring, which the member-access walk
 * cannot see: `const { API_KEY } = environmentVariables` contains no property- or
 * element-access node, yet delivers the value by name exactly like a subscript.
 *
 * Covers the declaration form (renames, defaults, string-literal keys) and the assignment
 * form `({ API_KEY } = environmentVariables)`. A `...rest` element is returned separately:
 * it names no key but takes every value, so the caller reports every configured name — the
 * alternative leaves `const { ...all } = environmentVariables; return all` entirely unmasked.
 * A computed key (`{ [k]: v }`) stays unrecognized, the same runtime-name boundary as a
 * computed subscript, and an initializer that is not the bare identifier (`other.env…`,
 * `environmentVariables ?? {}`) is not attributed.
 */
function destructuredEnvironmentReads(node: ts.Node): DestructuredEnvironmentReads | undefined {
  let pattern: ts.ObjectBindingPattern | ts.ObjectLiteralExpression | undefined
  if (ts.isObjectBindingPattern(node)) {
    /**
     * One receiver rule wherever the pattern sits: a variable declaration, a parameter
     * default (`function f({ KEY } = environmentVariables)`), or a binding element's own
     * default all hang the initializer off the pattern's parent, so checking the parent's
     * initializer covers every declaration position without per-kind cases.
     */
    const parent = node.parent
    const initializer =
      ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)
        ? parent.initializer
        : undefined
    if (initializer === undefined || !isEnvironmentReceiver(initializer)) return undefined
    pattern = node
  } else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isEnvironmentReceiver(node.right) &&
    ts.isObjectLiteralExpression(node.left)
  ) {
    pattern = node.left
  }
  if (!pattern) return undefined

  const result: DestructuredEnvironmentReads = { reads: [] }
  const record = (name: ts.PropertyName | ts.Identifier, offset: number): void => {
    /**
     * A computed key holding a string literal — `{ ['API_KEY']: key }` — is the element-access
     * rule in pattern position, so it resolves like a literal subscript; a computed key
     * holding anything else stays the runtime-name boundary a computed subscript already has.
     */
    if (ts.isComputedPropertyName(name)) {
      const key = unwrapParentheses(name.expression)
      if (ts.isStringLiteralLike(key) && key.text) result.reads.push({ name: key.text, offset })
      return
    }
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
      if (name.text) result.reads.push({ name: name.text, offset })
    }
  }
  if (ts.isObjectBindingPattern(pattern)) {
    for (const element of pattern.elements) {
      if (element.dotDotDotToken) {
        result.restOffset = element.getStart()
        continue
      }
      record(element.propertyName ?? (element.name as ts.Identifier), element.getStart())
    }
  } else {
    for (const property of pattern.properties) {
      if (ts.isSpreadAssignment(property)) {
        result.restOffset = property.getStart()
      } else if (ts.isShorthandPropertyAssignment(property)) {
        record(property.name, property.getStart())
      } else if (ts.isPropertyAssignment(property)) {
        record(property.name, property.getStart())
      }
    }
  }
  return result
}

interface AnnexBHtmlCommentRange {
  start: number
  end: number
  markerLength: 3 | 4
}

function collectDecodedSyntax(code: string): DecodedJavaScriptSyntax {
  const sourceFile = ts.createSourceFile(
    'user-code-original.js',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const identifierNames: string[] = []
  const values: string[] = []
  const environmentReads: DirectEnvironmentRead[] = []
  let environmentRestReadOffset: number | undefined
  const visit = (node: ts.Node): void => {
    const isTemplateToken =
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || isTemplateToken) {
      const text: unknown = Reflect.get(node, 'text')
      if (typeof text === 'string' && text) values.push(text)
      if (ts.isIdentifier(node) && node.text) identifierNames.push(node.text)
      const rawText: unknown = Reflect.get(node, 'rawText')
      if (typeof rawText === 'string' && rawText) values.push(rawText)
    }
    /** Kind-checked inline: this visitor runs for every node in the file, and a call per
     *  node to re-test the same two kinds is measurable on a large source. */
    if (
      node.kind === ts.SyntaxKind.PropertyAccessExpression ||
      node.kind === ts.SyntaxKind.ElementAccessExpression
    ) {
      const environmentRead = directEnvironmentRead(node)
      if (environmentRead) environmentReads.push(environmentRead)
    } else if (
      node.kind === ts.SyntaxKind.ObjectBindingPattern ||
      node.kind === ts.SyntaxKind.BinaryExpression
    ) {
      const destructured = destructuredEnvironmentReads(node)
      if (destructured) {
        environmentReads.push(...destructured.reads)
        if (destructured.restOffset !== undefined) {
          environmentRestReadOffset ??= destructured.restOffset
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  /**
   * A local binding that shadows the runtime environment name is deliberately NOT used to
   * discard these reads.
   *
   * Doing so was file-wide, so a helper declaring its own `environmentVariables` silently
   * dropped genuine reads of the mounted binding everywhere else in the source, and a dropped
   * read never reaches the output matcher — leaving a real secret unmasked. Reporting a read
   * off a shadowing local costs far less: the matcher is given that secret's exact value, the
   * code never emits it, and nothing matches.
   */
  return { identifierNames, values, environmentReads, environmentRestReadOffset }
}

function collectForbiddenSentinels(
  values: readonly string[],
  lengths: ReadonlySet<number>
): Map<number, Set<string>> {
  const forbidden = new Map<number, Set<string>>()
  for (const value of values) {
    for (const match of value.matchAll(/(?=(\$[0-9A-Za-z]*\$))/g)) {
      const sentinel = match[1]
      if (!lengths.has(sentinel.length)) continue
      const entries = forbidden.get(sentinel.length) ?? new Set<string>()
      entries.add(sentinel)
      forbidden.set(sentinel.length, entries)
    }
  }
  return forbidden
}

function encodeSentinelIndex(index: number, length: number): string | undefined {
  const characters = new Array<string>(length).fill(SENTINEL_ALPHABET[0])
  let remaining = index
  for (let cursor = length - 1; cursor >= 0 && remaining > 0; cursor -= 1) {
    characters[cursor] = SENTINEL_ALPHABET[remaining % SENTINEL_ALPHABET.length]
    remaining = Math.floor(remaining / SENTINEL_ALPHABET.length)
  }
  return remaining === 0 ? characters.join('') : undefined
}

function createSentinel(
  forbidden: ReadonlyMap<number, ReadonlySet<string>>,
  length: number,
  nextCandidateByLength: Map<number, number>
): string {
  const payloadLength = length - 2
  let candidateIndex = nextCandidateByLength.get(length) ?? 0
  for (;;) {
    const encoded = encodeSentinelIndex(candidateIndex, payloadLength)
    if (!encoded) break
    candidateIndex += 1
    const sentinel = `$${encoded}$`
    if (!forbidden.get(length)?.has(sentinel)) {
      nextCandidateByLength.set(length, candidateIndex)
      return sentinel
    }
  }
  throw new CodePlaceholderCompileError('Unable to allocate a collision-free parser sentinel')
}

function createSentinelSource(
  code: string,
  occurrences: CodePlaceholderOccurrence[],
  decodedValues: readonly string[]
): { source: string; sentinelOccurrences: SentinelOccurrence[] } {
  const nextCandidateByLength = new Map<number, number>()
  const lengths = new Set(occurrences.map((occurrence) => occurrence.end - occurrence.start))
  const forbidden = collectForbiddenSentinels([code, ...decodedValues], lengths)
  const sentinelOccurrences = occurrences.map((occurrence) => ({
    occurrence,
    sentinel: createSentinel(forbidden, occurrence.end - occurrence.start, nextCandidateByLength),
  }))
  let cursor = 0
  let source = ''
  for (const item of sentinelOccurrences) {
    source += code.slice(cursor, item.occurrence.start)
    source += item.sentinel
    cursor = item.occurrence.end
  }
  return { source: source + code.slice(cursor), sentinelOccurrences }
}

function collectRegularExpressionRanges(sourceFile: ts.SourceFile): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      ranges.push([node.getStart(sourceFile), node.getEnd()])
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return ranges
}

function maskSourceRanges(source: string, ranges: ReadonlyArray<[number, number]>): string {
  const edits = ranges.map(([start, end]) => ({
    start,
    end,
    text: source.slice(start, end).replace(/[^\r\n]/g, ' '),
  }))
  return applySourceEdits(source, edits)
}

function collectStandardCommentRanges(
  source: string,
  sourceFile: ts.SourceFile
): Array<[number, number]> {
  const scannerSource = maskSourceRanges(source, collectRegularExpressionRanges(sourceFile))
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    scannerSource
  )
  const ranges: Array<[number, number]> = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia ||
      token === ts.SyntaxKind.ShebangTrivia
    ) {
      ranges.push([scanner.getTokenPos(), scanner.getTextPos()])
    }
  }
  return ranges
}

function collectJavaScriptLiteralRanges(sourceFile: ts.SourceFile): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const visit = (node: ts.Node): void => {
    const isTemplateToken =
      node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    if (
      ts.isStringLiteralLike(node) ||
      isTemplateToken ||
      node.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      ranges.push([node.getStart(sourceFile), node.getEnd()])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return ranges
}

function collectAnnexBHtmlCommentRanges(
  source: string,
  sourceFile: ts.SourceFile
): AnnexBHtmlCommentRange[] {
  const protectedRanges = [
    ...collectStandardCommentRanges(source, sourceFile),
    ...collectJavaScriptLiteralRanges(sourceFile),
  ]
  const ranges: AnnexBHtmlCommentRange[] = []

  let lineStart = 0
  while (lineStart < source.length) {
    const newline = source.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? source.length : newline
    const leadingWhitespace = /^\s*/.exec(source.slice(lineStart, lineEnd))?.[0].length ?? 0
    const closeMarker = lineStart + leadingWhitespace
    if (source.startsWith('-->', closeMarker) && !isOffsetInRanges(closeMarker, protectedRanges)) {
      ranges.push({ start: closeMarker, end: lineEnd, markerLength: 3 })
      lineStart = newline === -1 ? source.length : newline + 1
      continue
    }

    let openMarker = source.indexOf('<!--', lineStart)
    while (openMarker >= 0 && openMarker < lineEnd) {
      if (!isOffsetInRanges(openMarker, protectedRanges)) {
        ranges.push({ start: openMarker, end: lineEnd, markerLength: 4 })
        break
      }
      openMarker = source.indexOf('<!--', openMarker + 4)
    }
    lineStart = newline === -1 ? source.length : newline + 1
  }

  return ranges
}

function createAnnexBHtmlCommentEdits(ranges: AnnexBHtmlCommentRange[]): SourceEdit[] {
  return ranges.map(({ start, markerLength }) => ({
    start,
    end: start + markerLength,
    text: markerLength === 4 ? '//  ' : '// ',
  }))
}

function assertSyntacticallyValidJavaScript(
  source: string,
  originalCode: string,
  sourceFile: ts.SourceFile
): void {
  const diagnostics = Reflect.get(sourceFile, 'parseDiagnostics') as
    | readonly ts.Diagnostic[]
    | undefined
  const diagnostic = diagnostics?.[0]
  if (!diagnostic) return

  throw new CodePlaceholderCompileError(
    `Invalid JavaScript syntax: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    originalCode,
    diagnostic.start ?? source.length
  )
}

function occurrencesInNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sentinelOccurrences: SentinelOccurrence[]
): SentinelOccurrence[] {
  const start = node.getStart(sourceFile)
  const end = node.getEnd()
  let lower = 0
  let upper = sentinelOccurrences.length
  while (lower < upper) {
    const middle = (lower + upper) >>> 1
    if (sentinelOccurrences[middle].occurrence.start < start) lower = middle + 1
    else upper = middle
  }
  const items: SentinelOccurrence[] = []
  for (let index = lower; index < sentinelOccurrences.length; index += 1) {
    const item = sentinelOccurrences[index]
    if (item.occurrence.start >= end) break
    if (item.occurrence.end <= end) items.push(item)
  }
  return items
}

function restoreUnresolvedSentinels(value: string, items: SentinelOccurrence[]): string {
  const rawBySentinel = new Map(items.map((item) => [item.sentinel, item.occurrence.raw]))
  return value.replace(/\$[0-9A-Za-z]*\$/g, (sentinel) => rawBySentinel.get(sentinel) ?? sentinel)
}

const UNSAFE_JAVASCRIPT_SOURCE_CHARACTERS = /[<>\u2028\u2029]/g

/** Serializes a string literal without embedding HTML terminators or JavaScript line separators. */
function serializeJavaScriptStringLiteral(value: string): string {
  return JSON.stringify(value).replace(
    UNSAFE_JAVASCRIPT_SOURCE_CHARACTERS,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

function buildStringExpression(
  value: string,
  items: SentinelOccurrence[],
  resolve: (occurrence: CodePlaceholderOccurrence) => ResolvedCodePlaceholderOccurrence | undefined,
  consumed: Set<CodePlaceholderOccurrence>
): string | undefined {
  const bySentinel = new Map(items.map((item) => [item.sentinel, item]))
  const restore = (text: string): string =>
    text.replace(/\$[0-9A-Za-z]*\$/g, (sentinel) => {
      const item = bySentinel.get(sentinel)
      return item?.occurrence.raw ?? sentinel
    })
  const parts: string[] = []
  let cursor = 0
  let matched = false
  for (const match of value.matchAll(/\$[0-9A-Za-z]*\$/g)) {
    const item = bySentinel.get(match[0])
    if (!item || match.index === undefined) continue
    const resolved = resolve(item.occurrence)
    if (!resolved) continue
    matched = true
    parts.push(serializeJavaScriptStringLiteral(restore(value.slice(cursor, match.index))))
    parts.push(resolved.bindingName)
    cursor = match.index + match[0].length
    consumed.add(item.occurrence)
  }
  if (!matched) return undefined
  parts.push(serializeJavaScriptStringLiteral(restore(value.slice(cursor))))
  return `(${parts.join(' + ')})`
}

function isStaticModuleSpecifier(node: ts.StringLiteral): boolean {
  const parent = node.parent
  return (
    ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
      parent.moduleSpecifier === node) ||
    (ts.isExternalModuleReference(parent) && parent.expression === node)
  )
}

function isPropertyName(node: ts.Node): boolean {
  const parent = node.parent
  return (
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node)
  )
}

function isDeclarationIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isLabeledStatement(parent)) return parent.label === node
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isBindingElement(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isExportSpecifier(parent)) &&
      parent.name === node) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
  )
}

function isWriteIdentifier(node: ts.Identifier): boolean {
  let current: ts.Node = node
  let targetPosition = true
  for (let parent = current.parent; parent; current = parent, parent = parent.parent) {
    if (
      (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
      parent.operand === current
    ) {
      return (
        targetPosition &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken ||
          parent.operator === ts.SyntaxKind.MinusMinusToken)
      )
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (parent.left === current) return targetPosition
      if (parent.right === current) targetPosition = false
      continue
    }
    if (
      (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) &&
      parent.initializer === current
    ) {
      return targetPosition
    }
    if (ts.isComputedPropertyName(parent)) {
      targetPosition = false
      continue
    }
    if (ts.isPropertyAssignment(parent)) {
      if (parent.name === current) targetPosition = false
      continue
    }
    if (
      ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent) ||
      ts.isCallExpression(parent) ||
      ts.isNewExpression(parent)
    ) {
      targetPosition = false
      continue
    }
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isSpreadElement(parent)
    ) {
      continue
    }
    targetPosition = false
  }
  return false
}

type TemplateToken =
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail

const CONTAINS_INVALID_TEMPLATE_ESCAPE_FLAG = 1 << 11

function getTaggedTemplateTokens(node: ts.TaggedTemplateExpression): TemplateToken[] {
  if (ts.isNoSubstitutionTemplateLiteral(node.template)) return [node.template]
  return [node.template.head, ...node.template.templateSpans.map((span) => span.literal)]
}

function getTemplateTokenRawText(token: TemplateToken): string {
  if (token.rawText !== undefined) return token.rawText
  const text = token.getText()
  if (ts.isNoSubstitutionTemplateLiteral(token)) return text.slice(1, -1)
  if (ts.isTemplateHead(token) || ts.isTemplateMiddle(token)) return text.slice(1, -2)
  return text.slice(1, -1)
}

function hasInvalidTemplateEscape(token: TemplateToken): boolean {
  const flags: unknown = Reflect.get(token, 'templateFlags')
  return typeof flags === 'number' && (flags & CONTAINS_INVALID_TEMPLATE_ESCAPE_FLAG) !== 0
}

function replaceSentinelsInTemplateToken(
  tokenText: string,
  tokenStart: number,
  items: SentinelOccurrence[],
  resolve: (occurrence: CodePlaceholderOccurrence) => ResolvedCodePlaceholderOccurrence | undefined,
  consumed: Set<CodePlaceholderOccurrence>
): string {
  let result = ''
  let cursor = 0
  for (const item of [...items].sort(
    (left, right) => left.occurrence.start - right.occurrence.start
  )) {
    const markerStart = item.occurrence.start - tokenStart
    let precedingText = tokenText.slice(cursor, markerStart)
    const resolved = resolve(item.occurrence)
    if (resolved) {
      let precedingBackslashes = 0
      for (let index = precedingText.length - 1; precedingText[index] === '\\'; index -= 1) {
        precedingBackslashes += 1
      }
      if (precedingBackslashes % 2 === 1) precedingText = precedingText.slice(0, -1)
      result += `${precedingText}\${${resolved.bindingName}}`
      consumed.add(item.occurrence)
    } else {
      result += precedingText + item.occurrence.raw
    }
    cursor = markerStart + item.sentinel.length
  }
  return result + tokenText.slice(cursor)
}

function regexParts(text: string): { pattern: string; flags: string } | undefined {
  if (!text.startsWith('/')) return undefined
  const lastSlash = text.lastIndexOf('/')
  if (lastSlash <= 0) return undefined
  return { pattern: text.slice(1, lastSlash), flags: text.slice(lastSlash + 1) }
}

export async function compileJavaScriptPlaceholders(
  input: InternalCompileCodePlaceholdersInput
): Promise<CompiledCodePlaceholders> {
  const decodedSyntax = collectDecodedSyntax(input.code)
  const context = createCodePlaceholderCompilationContext({
    ...input,
    reservedNames: [...(input.reservedNames ?? []), ...decodedSyntax.identifierNames],
  })
  /**
   * Recorded before the no-placeholder early return below: code that only reads the
   * environment directly has no `{{NAME}}` occurrence at all, and that is exactly the case
   * this exists to cover.
   */
  for (const read of decodedSyntax.environmentReads) {
    context.recordDirectEnvironmentRead(read.name, read.offset)
  }
  if (decodedSyntax.environmentRestReadOffset !== undefined) {
    /** `...rest` delivers every configured value at once, so every configured name is a read. */
    for (const name of Object.keys(input.environmentVariables ?? {})) {
      context.recordDirectEnvironmentRead(name, decodedSyntax.environmentRestReadOffset)
    }
  }
  if (context.occurrences.length === 0) {
    const sourceFile = ts.createSourceFile(
      'user-code.js',
      input.code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    )
    const htmlCommentRanges = collectAnnexBHtmlCommentRanges(input.code, sourceFile)
    return context.finish(
      applySourceEdits(input.code, createAnnexBHtmlCommentEdits(htmlCommentRanges))
    )
  }

  const { source, sentinelOccurrences } = createSentinelSource(
    input.code,
    context.occurrences,
    decodedSyntax.values
  )
  const preliminarySourceFile = ts.createSourceFile(
    'user-code.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const htmlCommentRanges = collectAnnexBHtmlCommentRanges(source, preliminarySourceFile)
  const parserSource = maskSourceRanges(
    source,
    htmlCommentRanges.map(({ start, end }) => [start, end])
  )
  const sourceFile = ts.createSourceFile(
    'user-code.js',
    parserSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  if (!input.analysisOnly) assertSyntacticallyValidJavaScript(source, input.code, sourceFile)
  const commentRanges: Array<[number, number]> = [
    ...collectStandardCommentRanges(parserSource, sourceFile),
    ...htmlCommentRanges.map(({ start, end }) => [start, end] as [number, number]),
  ]
  const itemByRange = new Map(
    sentinelOccurrences.map((item) => [`${item.occurrence.start}:${item.occurrence.end}`, item])
  )
  const consumed = new Set<CodePlaceholderOccurrence>()
  const edits = createAnnexBHtmlCommentEdits(htmlCommentRanges)
  let taggedTemplateSiteIndex = 0

  const rejectUnsupported = (item: SentinelOccurrence, contextName: string): void => {
    if (input.analysisOnly) {
      context.resolveValue(item.occurrence)
      consumed.add(item.occurrence)
      return
    }
    throw new CodePlaceholderCompileError(
      `Variable placeholder "${item.occurrence.name}" is not supported in ${contextName}`,
      input.code,
      item.occurrence.start
    )
  }

  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tokens = getTaggedTemplateTokens(node)
      const tokenItems = tokens.map((token) =>
        occurrencesInNode(token, sourceFile, sentinelOccurrences)
      )
      const hasResolvedLiteralPlaceholder = tokenItems.some((items) =>
        items.some((item) => context.hasValue(item.occurrence.name))
      )
      if (!hasResolvedLiteralPlaceholder) {
        ts.forEachChild(node, visit)
        return
      }

      const nestedEditStart = edits.length
      visit(node.tag)
      if (ts.isTemplateExpression(node.template)) {
        for (const span of node.template.templateSpans) visit(span.expression)
      }
      const nestedEdits = edits.splice(nestedEditStart)
      const transformedNodeText = (child: ts.Node): string => {
        const childStart = child.getStart(sourceFile)
        const childEnd = child.getEnd()
        const childEdits = nestedEdits
          .filter((edit) => edit.start >= childStart && edit.end <= childEnd)
          .map((edit) => ({
            ...edit,
            start: edit.start - childStart,
            end: edit.end - childStart,
          }))
        return restoreUnresolvedSentinels(
          applySourceEdits(source.slice(childStart, childEnd), childEdits),
          occurrencesInNode(child, sourceFile, sentinelOccurrences)
        )
      }
      const segmentExpression = (value: string, items: SentinelOccurrence[]): string =>
        buildStringExpression(value, items, context.resolve, consumed) ??
        serializeJavaScriptStringLiteral(restoreUnresolvedSentinels(value, items))
      const cookedSegments = tokens.map((token, index) =>
        hasInvalidTemplateEscape(token)
          ? 'undefined'
          : segmentExpression(token.text, tokenItems[index])
      )
      const rawSegments = tokens.map((token, index) =>
        segmentExpression(getTemplateTokenRawText(token), tokenItems[index])
      )
      const intrinsics = context.runtimeBindingFor('javascript-runtime')
      const templateObject = [
        '((cooked, raw, intrinsics) =>',
        'intrinsics.freeze(intrinsics.defineProperty(cooked, "raw",',
        '{ value: intrinsics.freeze(raw) })))',
        `([${cookedSegments.join(', ')}], [${rawSegments.join(', ')}], ${intrinsics.name})`,
      ].join(' ')
      const cachedTemplateObject = `${intrinsics.name}.template(${taggedTemplateSiteIndex}, () => ${templateObject})`
      taggedTemplateSiteIndex += 1
      const substitutionExpressions = ts.isTemplateExpression(node.template)
        ? node.template.templateSpans.map((span) => transformedNodeText(span.expression))
        : []
      edits.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: `((${transformedNodeText(node.tag)})(${[
          cachedTemplateObject,
          ...substitutionExpressions,
        ].join(', ')}))`,
      })
      return
    }

    if (ts.isStringLiteral(node)) {
      const items = occurrencesInNode(node, sourceFile, sentinelOccurrences)
      if (items.length === 0) return
      if (isStaticModuleSpecifier(node)) {
        const resolved = items.find((item) => context.hasValue(item.occurrence.name))
        if (resolved) rejectUnsupported(resolved, 'a static import or export specifier')
        return
      }
      const expression = buildStringExpression(node.text, items, context.resolve, consumed)
      if (!expression) return
      edits.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: isPropertyName(node) ? `[${expression}]` : expression,
      })
      return
    }

    if (
      node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      const text = node.getText(sourceFile)
      const items = occurrencesInNode(node, sourceFile, sentinelOccurrences)
      if (items.length === 0) return
      const templateRoot = ts.isTemplateExpression(node.parent)
        ? node.parent
        : ts.isTemplateSpan(node.parent) && ts.isTemplateExpression(node.parent.parent)
          ? node.parent.parent
          : node
      if (ts.isTaggedTemplateExpression(templateRoot.parent)) return
      const replacement = replaceSentinelsInTemplateToken(
        text,
        node.getStart(sourceFile),
        items,
        context.resolve,
        consumed
      )
      edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: replacement })
      return
    }

    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const text = node.getText(sourceFile)
      const items = occurrencesInNode(node, sourceFile, sentinelOccurrences)
      if (items.length === 0) return
      const parsed = regexParts(text)
      if (!parsed) {
        rejectUnsupported(items[0], 'a regular-expression literal')
        return
      }
      const expression = buildStringExpression(parsed.pattern, items, context.resolve, consumed)
      if (!expression) return
      const intrinsics = context.runtimeBindingFor('javascript-runtime')
      edits.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: `new ${intrinsics.name}.RegExp(${expression}, ${serializeJavaScriptStringLiteral(parsed.flags)})`,
      })
      return
    }

    if (ts.isIdentifier(node)) {
      const item = itemByRange.get(`${node.getStart(sourceFile)}:${node.getEnd()}`)
      if (!item || isOffsetInRanges(item.occurrence.start, commentRanges)) return
      const resolved = context.resolve(item.occurrence)
      if (!resolved) return
      if (isDeclarationIdentifier(node) || isWriteIdentifier(node)) {
        rejectUnsupported(item, 'a declaration, label, or assignment target')
        return
      }
      const accessor = resolved.bindingName
      const parent = node.parent
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        edits.push({
          start: parent.expression.getEnd(),
          end: node.getEnd(),
          text: parent.questionDotToken ? `?.[${accessor}]` : `[${accessor}]`,
        })
      } else if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
        edits.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: `[${accessor}]: ${accessor}`,
        })
      } else if (isPropertyName(node)) {
        edits.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: `[${accessor}]`,
        })
      } else if (
        parent.kind >= ts.SyntaxKind.JsxElement &&
        parent.kind <= ts.SyntaxKind.JsxAttribute
      ) {
        rejectUnsupported(item, 'JSX syntax')
        return
      } else {
        edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: accessor })
      }
      consumed.add(item.occurrence)
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  for (const item of sentinelOccurrences) {
    if (isOffsetInRanges(item.occurrence.start, commentRanges)) continue
    if (!context.hasValue(item.occurrence.name) || consumed.has(item.occurrence)) continue
    rejectUnsupported(item, 'this JavaScript syntax position')
  }

  const transformed = applySourceEdits(input.code, edits)
  return context.finish(transformed)
}
