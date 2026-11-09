import type {
  Sandbox,
  SandboxCliToolId,
  SandboxDependencyIssue,
  SandboxValidationError,
} from '@/lib/api/contracts/sandboxes'
import {
  SANDBOX_CLI_TOOL_CATEGORIES,
  SANDBOX_CLI_TOOLS,
  SANDBOX_SELECTABLE_CLI_TOOL_IDS,
} from '@/lib/execution/remote-sandbox/cli-tools'

type SandboxLanguage = Sandbox['language']

export const SANDBOX_UPGRADE_TITLE = 'Sandboxes require an active Max plan'
export const SANDBOX_UPGRADE_DESCRIPTION =
  'Upgrade to Max and ensure billing is active to add dependencies, system packages, and managed CLI tools to Function blocks.'

/** Ordered to match the Function block's own `language` dropdown. */
export const LANGUAGE_OPTIONS = [
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python' },
] as const satisfies readonly { label: string; value: SandboxLanguage }[]

/** The selectable managed CLIs, grouped by category in catalog order. */
export const CLI_TOOL_OPTIONS = SANDBOX_CLI_TOOL_CATEGORIES.flatMap((category) =>
  SANDBOX_SELECTABLE_CLI_TOOL_IDS.filter((id) => SANDBOX_CLI_TOOLS[id].category === category).map(
    (id) => ({ value: id, label: SANDBOX_CLI_TOOLS[id].label })
  )
)

/** Placeholders double as the format documentation, so they swap with the language. */
export const DEPENDENCY_PLACEHOLDERS: Record<SandboxLanguage, string> = {
  python: 'google-cloud-bigquery==3.25.0\npyairtable>=3.0\npandas',
  javascript: 'axios@^1.7.0\n@aws-sdk/client-s3\nzod',
}

export const SYSTEM_PACKAGE_PLACEHOLDER = 'shellcheck\npandoc\ngraphviz'

export interface SandboxDraft {
  name: string
  language: SandboxLanguage
  /** Raw textarea contents: one dependency per line, comments allowed. */
  dependencies: string
  /** Raw textarea contents: one Debian/APT package per line, comments allowed. */
  systemPackages: string
  cliTools: SandboxCliToolId[]
}

export function canRetrySandboxBuild({
  canAdmin,
  isDirty,
  saving,
}: {
  canAdmin: boolean
  isDirty: boolean
  saving: boolean
}): boolean {
  return canAdmin && !isDirty && !saving
}

export function draftFromSandbox(sandbox: Sandbox): SandboxDraft {
  return {
    name: sandbox.name,
    language: sandbox.language,
    dependencies: sandbox.dependencies.join('\n'),
    systemPackages: sandbox.systemPackages.join('\n'),
    cliTools: sandbox.cliTools,
  }
}

/** Defaults to the Function block's own default language so the two agree. */
export function emptyDraft(): SandboxDraft {
  return {
    name: '',
    language: 'javascript',
    dependencies: '',
    systemPackages: '',
    cliTools: [],
  }
}

/** Splits the textarea into one entry per row so a rejection keeps its line number. */
export function toSubmittedLines(value: string): string[] {
  return value.split('\n')
}

interface SandboxLineIssues {
  field: SandboxValidationError['issueField']
  issues: SandboxDependencyIssue[]
}

/**
 * The per-line rejections of a failed save. The server addresses each to the row it was typed on,
 * so they surface against that textarea rather than as one opaque error.
 */
export function extractIssues(error: unknown): SandboxLineIssues | null {
  const body = (error as { body?: Partial<SandboxValidationError> })?.body
  if (!Array.isArray(body?.issues) || body.issues.length === 0) return null
  return {
    field: body.issueField === 'systemPackages' ? 'systemPackages' : 'dependencies',
    issues: body.issues,
  }
}
