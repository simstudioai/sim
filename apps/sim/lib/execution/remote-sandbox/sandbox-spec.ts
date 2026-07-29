import { createHash } from 'node:crypto'
import { CodeLanguage } from '@/lib/execution/languages'

/**
 * The languages a sandbox can carry dependencies for. Shell is excluded: a shell
 * execution has no package manager of its own, it borrows whichever sandbox the
 * `code` kind resolved.
 */
export type SandboxLanguage = `${CodeLanguage.JavaScript}` | `${CodeLanguage.Python}`

export const SANDBOX_LANGUAGES = [CodeLanguage.JavaScript, CodeLanguage.Python] as const

export function isSandboxLanguage(value: string): value is SandboxLanguage {
  return value === CodeLanguage.JavaScript || value === CodeLanguage.Python
}

/**
 * The package registry a language installs from, named as a user would recognize
 * it. Single source of truth so validation errors, build failures, and the wand
 * prompt all call it the same thing.
 */
export function registryFor(language: SandboxLanguage): string {
  return language === CodeLanguage.Python ? 'PyPI' : 'npm'
}

/**
 * A canonical, content-addressable dependency set. `dependencies` is always the
 * output of {@link canonicalizeDependencies}, so two specs that mean the same
 * thing are byte-identical and therefore hash identically.
 */
export interface SandboxSpec {
  language: SandboxLanguage
  dependencies: string[]
}

/** Upper bound on how many packages one sandbox may declare. */
export const MAX_SANDBOX_DEPENDENCIES = 50

/** Upper bound on the length of a single dependency entry. */
export const MAX_DEPENDENCY_LENGTH = 200

/**
 * Where the installed JavaScript packages live inside a sandbox, for both the
 * prebuilt (baked into the E2B template) and runtime (installed per execution)
 * strategies. Unlike pip, an npm install is not automatically importable — Node
 * resolves from `NODE_PATH` or the install location — so producer and consumer
 * must agree on one directory. They read it from here.
 */
export const SIM_DEPS_DIR = '/opt/sim-deps'

export const SIM_NODE_MODULES_DIR = `${SIM_DEPS_DIR}/node_modules`

/**
 * Where the runtime strategy writes the dependency manifests it installs from.
 *
 * Both live under `/tmp`, not {@link SIM_DEPS_DIR}: the install target is created
 * as root, while `SandboxHandle.writeFile` goes through the provider filesystem
 * API as the sandbox's default user — writing the manifest into the root-owned
 * directory fails with EACCES.
 */
export const SIM_REQUIREMENTS_PATH = '/tmp/sim-requirements.txt'

export const SIM_PACKAGE_JSON_PATH = '/tmp/sim-package.json'

/** A rejected dependency line, addressed back to the row the user typed it on. */
export interface DependencyIssue {
  /** 1-indexed line in the submitted list, so the editor can mark the exact row. */
  line: number
  value: string
  reason: string
}

export type DependencyValidation =
  | { ok: true; dependencies: string[] }
  | { ok: false; issues: DependencyIssue[] }

/**
 * PEP 508 distribution name followed by optional extras and an optional PEP 440
 * version specifier set. Deliberately whitespace-free — see
 * {@link quoteDependency} for why every accepted character has to be inert.
 */
const PYTHON_SPECIFIER = '(===|==|!=|<=|>=|~=|<|>)[A-Za-z0-9][A-Za-z0-9.*+!-]*'
const PYTHON_DEPENDENCY_PATTERN = new RegExp(
  '^[A-Za-z0-9][A-Za-z0-9._-]*' +
    '(\\[[A-Za-z0-9][A-Za-z0-9._-]*(,[A-Za-z0-9][A-Za-z0-9._-]*)*\\])?' +
    `(${PYTHON_SPECIFIER}(,${PYTHON_SPECIFIER})*)?$`
)

/** An npm package name, optionally scoped, with an optional `@range` suffix. */
const JS_DEPENDENCY_PATTERN =
  /^(@[a-z0-9][a-z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(@[\^~<>=]{0,2}[A-Za-z0-9*][A-Za-z0-9.*+-]*)?$/

/**
 * Prefixes and substrings rejected ahead of the shape check purely so the error
 * names the actual problem. The patterns above would reject all of these anyway.
 */
const DEPENDENCY_REJECTIONS: ReadonlyArray<{ match: RegExp; reason: string }> = [
  { match: /^-/, reason: 'installer flags are not allowed (remove the leading dash)' },
  { match: /^git\+|:\/\//, reason: 'URLs and VCS references are not allowed' },
  {
    match: /^(file|link|workspace|npm|portal|patch):/i,
    reason: 'local and alias specifiers are not allowed',
  },
  { match: /[\s]/, reason: 'a dependency cannot contain spaces' },
  { match: /[;&|`$(){}"'\\]/, reason: 'contains characters that are not valid in a package name' },
  { match: /^[./~]/, reason: 'local paths are not allowed' },
]

interface SourceLine {
  line: number
  value: string
}

/**
 * Splits a submitted dependency list into meaningful entries while keeping each
 * one addressed to the row it was typed on, so a rejection can be marked inline
 * rather than reported against a shifted index.
 */
function readDependencyLines(input: string | readonly string[]): SourceLine[] {
  const rawLines = typeof input === 'string' ? input.split('\n') : input
  const entries: SourceLine[] = []
  rawLines.forEach((raw, index) => {
    const value = (raw ?? '').trim()
    if (!value || value.startsWith('#')) return
    entries.push({ line: index + 1, value })
  })
  return entries
}

/**
 * Normalizes a Python distribution name per PEP 503, which PyPI treats as
 * case- and separator-insensitive. `Google_Cloud.BigQuery` and
 * `google-cloud-bigquery` are the same distribution, so they must reach the same
 * spec hash and share one build.
 *
 * npm names get no such treatment: the registry serves `React` and `react` as
 * distinct packages, so folding case there could install something the user did
 * not ask for.
 */
function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

function canonicalizeEntry(language: SandboxLanguage, value: string): string {
  if (language !== CodeLanguage.Python) return value
  const boundary = value.search(/[[<>=!~]/)
  if (boundary === -1) return normalizePythonName(value)
  return normalizePythonName(value.slice(0, boundary)) + value.slice(boundary)
}

/**
 * Reduces a validated dependency list to its canonical form: normalized,
 * de-duplicated, and sorted. Two lists that install the same thing collapse to
 * the same array, which is what makes {@link hashSandboxSpec} content-addressed.
 */
export function canonicalizeDependencies(
  language: SandboxLanguage,
  dependencies: readonly string[]
): string[] {
  const seen = new Set<string>()
  for (const dependency of dependencies) {
    seen.add(canonicalizeEntry(language, dependency.trim()))
  }
  return [...seen].sort()
}

/**
 * Validates a submitted dependency list and returns its canonical form.
 *
 * This is the security boundary for the whole feature. Every accepted entry is
 * eventually handed to pip or npm, on the E2B build path as a shell argument, so
 * the grammar here is a strict allowlist rather than a denylist: no whitespace,
 * no quoting, no redirection, no path or URL forms. Everything downstream —
 * {@link quoteDependency}, the runtime manifests — assumes that invariant holds.
 */
export function validateDependencies(
  language: SandboxLanguage,
  input: string | readonly string[]
): DependencyValidation {
  const entries = readDependencyLines(input)
  const issues: DependencyIssue[] = []

  // Reported once, against the first line over the cap. Marking every remaining
  // row would bury the real message under hundreds of identical ones and bloat
  // the response for a paste that is simply too long.
  const overflow = entries[MAX_SANDBOX_DEPENDENCIES]
  if (overflow) {
    issues.push({
      line: overflow.line,
      value: overflow.value,
      reason: `a sandbox can declare at most ${MAX_SANDBOX_DEPENDENCIES} dependencies (this list has ${entries.length})`,
    })
  }

  const pattern =
    language === CodeLanguage.Python ? PYTHON_DEPENDENCY_PATTERN : JS_DEPENDENCY_PATTERN
  const registryName = registryFor(language)

  for (const entry of entries.slice(0, MAX_SANDBOX_DEPENDENCIES)) {
    if (entry.value.length > MAX_DEPENDENCY_LENGTH) {
      issues.push({
        line: entry.line,
        value: entry.value,
        reason: `a dependency cannot be longer than ${MAX_DEPENDENCY_LENGTH} characters`,
      })
      continue
    }

    const rejection = DEPENDENCY_REJECTIONS.find((candidate) => candidate.match.test(entry.value))
    if (rejection) {
      issues.push({ line: entry.line, value: entry.value, reason: rejection.reason })
      continue
    }

    if (!pattern.test(entry.value)) {
      issues.push({
        line: entry.line,
        value: entry.value,
        reason: `not a valid ${registryName} package name or version specifier`,
      })
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    dependencies: canonicalizeDependencies(
      language,
      entries.map((e) => e.value)
    ),
  }
}

/**
 * Content address for a canonical spec. Keyed on language as well as
 * dependencies so the same package list under Python and JavaScript never
 * collides onto one build.
 */
export function hashSandboxSpec(spec: SandboxSpec): string {
  const canonical = JSON.stringify({
    language: spec.language,
    dependencies: canonicalizeDependencies(spec.language, spec.dependencies),
  })
  return createHash('sha256').update(canonical, 'utf-8').digest('hex')
}

/**
 * Quotes a validated dependency for an argv position in a shell command.
 *
 * The E2B template builder composes `pip install`/`npm install` as a shell
 * string, so an unquoted `django>=5.0` would redirect stdout to a file named
 * `=5.0` and silently install an unpinned Django. Validation already rejects
 * quotes and whitespace, so wrapping in single quotes is total — but the guard
 * stays, because this function is what makes that assumption load-bearing.
 */
export function quoteDependency(dependency: string): string {
  // Quotes and whitespace would break out of the argv slot; a leading dash would
  // stay inside it and be read by pip/npm as a FLAG (`--index-url=...`, `-t/`)
  // rather than a package. Specs are re-read from `sandbox_image.spec` JSONB long
  // after validation ran, so this check cannot lean on the writer having run it.
  if (/^-/.test(dependency) || /['"\s]/.test(dependency)) {
    throw new Error(`Refusing to shell-quote an unvalidated dependency: ${dependency}`)
  }
  return `'${dependency}'`
}

/**
 * Splits an npm spec into the name and range halves a `package.json`
 * `dependencies` map needs. The scope's leading `@` is skipped when looking for
 * the range separator so `@aws-sdk/client-s3` is not read as a range.
 */
export function parseJsDependency(dependency: string): { name: string; range: string } {
  const separator = dependency.lastIndexOf('@')
  if (separator <= 0) return { name: dependency, range: '*' }
  return { name: dependency.slice(0, separator), range: dependency.slice(separator + 1) || '*' }
}

/**
 * Renders the canonical list as the manifest the runtime strategy installs from.
 * The bytes are delivered through the sandbox filesystem API, never a shell, so
 * this is the second line of defense behind {@link validateDependencies}.
 */
export function renderDependencyManifest(spec: SandboxSpec): string {
  const dependencies = canonicalizeDependencies(spec.language, spec.dependencies)
  if (spec.language === CodeLanguage.Python) {
    return `${dependencies.join('\n')}\n`
  }
  const map: Record<string, string> = {}
  for (const dependency of dependencies) {
    const { name, range } = parseJsDependency(dependency)
    map[name] = range
  }
  return `${JSON.stringify({ name: 'sim-sandbox-deps', private: true, dependencies: map }, null, 2)}\n`
}
