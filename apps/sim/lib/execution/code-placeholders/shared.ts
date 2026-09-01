import { setRecordValue } from '@/lib/core/utils/records'
import type {
  CodePlaceholderBinding,
  CodePlaceholderCompilationContext,
  CodePlaceholderOccurrence,
  CodePlaceholderRuntimeBinding,
  CompiledCodePlaceholders,
  InternalCompileCodePlaceholdersInput,
  ResolvedCodePlaceholderOccurrence,
  ResolvedCodePlaceholderValueOccurrence,
} from '@/lib/execution/code-placeholders/types'

const MAX_PLACEHOLDERS = 10_000
const PLACEHOLDER_PATTERN = /\{\{([^}]+)\}\}/g

export class CodePlaceholderCompileError extends Error {
  readonly line?: number
  readonly column?: number

  constructor(message: string, code?: string, offset?: number) {
    super(message)
    this.name = 'CodePlaceholderCompileError'
    if (code !== undefined && offset !== undefined) {
      const prefix = code.slice(0, offset)
      this.line = prefix.split('\n').length
      this.column = offset - prefix.lastIndexOf('\n')
    }
  }
}

export function collectCodePlaceholderOccurrences(code: string): CodePlaceholderOccurrence[] {
  const occurrences: CodePlaceholderOccurrence[] = []
  let match: RegExpExecArray | null
  PLACEHOLDER_PATTERN.lastIndex = 0
  while ((match = PLACEHOLDER_PATTERN.exec(code)) !== null) {
    const name = match[1].trim()
    if (!name) continue
    occurrences.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      name,
    })
    if (occurrences.length > MAX_PLACEHOLDERS) {
      throw new CodePlaceholderCompileError(
        `Code contains more than ${MAX_PLACEHOLDERS} variable placeholders`
      )
    }
  }
  return occurrences
}

function chooseNamespace(code: string, reservedNames: ReadonlySet<string>): string {
  const occupied = new Set<number>()
  const collectOccupiedNamespaces = (value: string): void => {
    for (const match of value.matchAll(/__sim_code_(\d+)/g)) occupied.add(Number(match[1]))
  }
  collectOccupiedNamespaces(code)
  const normalizedCode = code.normalize('NFKC')
  if (normalizedCode !== code) collectOccupiedNamespaces(normalizedCode)
  for (const name of reservedNames) {
    const match = /^__sim_code_(\d+)(?:_|$)/.exec(name)
    if (match) occupied.add(Number(match[1]))
  }
  for (let index = 0; ; index += 1) {
    if (!occupied.has(index)) return `__sim_code_${index}`
  }
}

function stringifyResolverValues(
  params: Record<string, unknown>,
  environmentVariables: Record<string, string>,
  referencedNames: ReadonlySet<string>
): Record<string, string> {
  const values: Record<string, string> = Object.create(null)
  for (const [name, value] of Object.entries(params)) {
    if (!referencedNames.has(name)) continue
    if (value !== undefined && value !== null) setRecordValue(values, name, String(value))
  }
  for (const [name, value] of Object.entries(environmentVariables)) {
    if (!referencedNames.has(name)) continue
    if (value !== undefined && value !== null) setRecordValue(values, name, value)
  }
  return values
}

export function createCodePlaceholderCompilationContext(
  input: InternalCompileCodePlaceholdersInput,
  options: { identifierSuffix?: string } = {}
): CodePlaceholderCompilationContext {
  const params = input.params ?? {}
  const environmentVariables = input.environmentVariables ?? {}
  const occurrences = collectCodePlaceholderOccurrences(input.code)
  const referencedNames = new Set(occurrences.map((occurrence) => occurrence.name))
  const values = stringifyResolverValues(params, environmentVariables, referencedNames)
  const reservedNames = new Set(input.reservedNames ?? [])
  for (const name of Object.keys(environmentVariables)) reservedNames.add(name)
  for (const name of Object.keys(params)) reservedNames.add(name)

  const namespace =
    occurrences.length > 0 ? chooseNamespace(input.code, reservedNames) : '__sim_code_0'
  const bindingByName = new Map<string, CodePlaceholderBinding>()
  const runtimeBindingByKind = new Map<
    CodePlaceholderRuntimeBinding['kind'],
    CodePlaceholderRuntimeBinding
  >()
  const resolvedSecretNameOffsets = new Map<string, number>()
  const privateInputs: Array<{ environmentVariable: string; content: string }> = []
  const privateInputByContent = new Map<string, { environmentVariable: string; content: string }>()
  const internalIdentifiers = new Set<string>()

  const hasValue = (name: string): boolean =>
    input.analysisOnly === true || Object.hasOwn(values, name)

  const recordResolution = (occurrence: CodePlaceholderOccurrence): void => {
    if (!input.analysisOnly && !Object.hasOwn(environmentVariables, occurrence.name)) return
    const currentOffset = resolvedSecretNameOffsets.get(occurrence.name)
    if (currentOffset === undefined || occurrence.start < currentOffset) {
      resolvedSecretNameOffsets.set(occurrence.name, occurrence.start)
    }
  }

  /**
   * The gate {@link recordDirectEnvironmentRead} applies, exposed so a scanner can drop
   * candidates before classifying them. Deciding whether an expansion really runs costs a
   * lex or a quote-frame pass over the whole document, and the overwhelming majority of
   * `$VAR` / `environmentVariables[...]` reads in real code name something that is not a
   * configured secret — so answering "would this even be recorded" first keeps those passes
   * off the common path entirely.
   */
  const tracksDirectEnvironmentRead = (name: string): boolean =>
    !input.analysisOnly && Object.hasOwn(environmentVariables, name)

  /**
   * Records a secret the code reads straight off the runtime environment —
   * `environmentVariables.NAME` / `environmentVariables['NAME']` in JavaScript and Python,
   * `$NAME` in shell — rather than through a `{{NAME}}` placeholder.
   *
   * Those reads reach the same value but were invisible to this compiler, so nothing
   * downstream knew the secret was live: it never entered the run's active provenance, and
   * execution-log masking is activated by that entry. A direct read was therefore a secret
   * the logs would not redact. Reporting it here fixes that at the source, because
   * `resolvedSecretNames` is already the channel the runtime boundary reads back.
   *
   * Deliberately inert under `analysisOnly`. That mode drives Copilot's secret mount, whose
   * policy is that code receives a value only for an explicit `{{NAME}}` reference; widening
   * it here would mount secrets on the strength of an identifier appearing in a string.
   */
  const recordDirectEnvironmentRead = (name: string, offset: number): void => {
    if (!tracksDirectEnvironmentRead(name)) return
    const currentOffset = resolvedSecretNameOffsets.get(name)
    if (currentOffset === undefined || offset < currentOffset) {
      resolvedSecretNameOffsets.set(name, offset)
    }
  }

  const resolveValue = (
    occurrence: CodePlaceholderOccurrence
  ): ResolvedCodePlaceholderValueOccurrence | undefined => {
    if (!hasValue(occurrence.name)) return undefined
    recordResolution(occurrence)
    return {
      ...occurrence,
      value: Object.hasOwn(values, occurrence.name) ? values[occurrence.name] : '',
    }
  }

  const ensureBinding = (name: string, value: string): CodePlaceholderBinding => {
    const existing = bindingByName.get(name)
    if (existing) return existing

    const bindingName = `${namespace}_binding_${bindingByName.size}${options.identifierSuffix ?? ''}`
    reservedNames.add(bindingName)
    internalIdentifiers.add(bindingName)
    const binding = { name: bindingName, value }
    bindingByName.set(name, binding)
    return binding
  }

  return {
    occurrences,
    hasValue,
    resolveValue,
    recordDirectEnvironmentRead,
    tracksDirectEnvironmentRead,
    runtimeBindingFor(kind) {
      const existing = runtimeBindingByKind.get(kind)
      if (existing) return existing

      const name = `${namespace}_runtime_${runtimeBindingByKind.size}${options.identifierSuffix ?? ''}`
      reservedNames.add(name)
      internalIdentifiers.add(name)
      const binding = { name, kind }
      runtimeBindingByKind.set(kind, binding)
      return binding
    },
    registerInternalIdentifier(identifier) {
      internalIdentifiers.add(identifier)
    },
    resolve(occurrence): ResolvedCodePlaceholderOccurrence | undefined {
      const resolved = resolveValue(occurrence)
      if (!resolved) return undefined
      const binding = ensureBinding(occurrence.name, resolved.value)
      return {
        ...resolved,
        bindingName: binding.name,
      }
    },
    createPrivateInput(content) {
      const existing = privateInputByContent.get(content)
      if (existing) return existing
      const environmentVariable = `${namespace}_input_${privateInputs.length}${options.identifierSuffix ?? ''}`
      reservedNames.add(environmentVariable)
      internalIdentifiers.add(environmentVariable)
      const privateInput = { environmentVariable, content }
      privateInputs.push(privateInput)
      privateInputByContent.set(content, privateInput)
      return privateInput
    },
    finish(code): CompiledCodePlaceholders {
      return {
        code,
        bindings: [...bindingByName.values()],
        privateInputs,
        runtimeBindings: [...runtimeBindingByKind.values()],
        resolvedSecretNames: [...resolvedSecretNameOffsets]
          .sort((left, right) => left[1] - right[1])
          .map(([name]) => name),
        internalIdentifiers: [...internalIdentifiers],
      }
    },
  }
}

export interface SourceEdit {
  start: number
  end: number
  text: string
}

export function applySourceEdits(code: string, edits: SourceEdit[]): string {
  if (edits.length === 0) return code
  const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)
  let cursor = 0
  let output = ''
  for (const edit of sorted) {
    if (edit.start < cursor || edit.end < edit.start || edit.end > code.length) {
      throw new CodePlaceholderCompileError('Overlapping code placeholder transformations')
    }
    output += code.slice(cursor, edit.start)
    output += edit.text
    cursor = edit.end
  }
  return output + code.slice(cursor)
}

export function isOffsetInRanges(offset: number, ranges: ReadonlyArray<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end)
}
