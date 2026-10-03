import type { CodeLanguage } from '@/lib/execution/languages'

export interface CodePlaceholderBinding {
  /** Opaque runtime name. It is indexed and never derived from the referenced variable name. */
  name: string
  value: string
}

export interface CodePlaceholderPrivateInput {
  /** Opaque environment variable that receives the sandbox-only file path. */
  environmentVariable: string
  content: string
}

export interface CodePlaceholderRuntimeBinding {
  /** Opaque runtime name installed before user code executes. */
  name: string
  kind: 'javascript-runtime'
}

export interface CompileCodePlaceholdersInput {
  code: string
  language: CodeLanguage
  params?: Record<string, unknown>
  environmentVariables?: Record<string, string>
  /** Runtime names already occupied by block/workflow context bindings. */
  reservedNames?: Iterable<string>
}

/** Internal adapter input; analysis mode is only reachable through the facade's analyzer. */
export interface InternalCompileCodePlaceholdersInput extends CompileCodePlaceholdersInput {
  analysisOnly: boolean
}

export interface CompiledCodePlaceholders {
  code: string
  bindings: readonly CodePlaceholderBinding[]
  privateInputs: readonly CodePlaceholderPrivateInput[]
  runtimeBindings: readonly CodePlaceholderRuntimeBinding[]
  /** Environment-origin placeholders actually compiled outside comments. */
  resolvedSecretNames: readonly string[]
  /** Generated names that must never be exposed in user-facing diagnostics. */
  internalIdentifiers: readonly string[]
}

export interface CodePlaceholderOccurrence {
  start: number
  end: number
  raw: string
  name: string
}

export interface ResolvedCodePlaceholderOccurrence extends CodePlaceholderOccurrence {
  bindingName: string
  value: string
}

export interface ResolvedCodePlaceholderValueOccurrence extends CodePlaceholderOccurrence {
  value: string
}

export interface CodePlaceholderCompilationContext {
  occurrences: CodePlaceholderOccurrence[]
  hasValue(name: string): boolean
  resolveValue(
    occurrence: CodePlaceholderOccurrence
  ): ResolvedCodePlaceholderValueOccurrence | undefined
  resolve(occurrence: CodePlaceholderOccurrence): ResolvedCodePlaceholderOccurrence | undefined
  /** Reports a secret read straight off the runtime environment, without a `{{NAME}}` placeholder. */
  recordDirectEnvironmentRead(name: string, offset: number): void
  /** Whether {@link recordDirectEnvironmentRead} would keep this name, so a scanner can skip work. */
  tracksDirectEnvironmentRead(name: string): boolean
  runtimeBindingFor(kind: CodePlaceholderRuntimeBinding['kind']): CodePlaceholderRuntimeBinding
  registerInternalIdentifier(identifier: string): void
  createPrivateInput(content: string): CodePlaceholderPrivateInput
  finish(code: string): CompiledCodePlaceholders
}
