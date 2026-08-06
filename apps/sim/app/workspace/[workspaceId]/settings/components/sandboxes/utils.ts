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

export type SandboxLanguage = Sandbox['language']

/** Shared by the settings page and the picker's create modal so the wall reads identically. */
export const SANDBOX_UPGRADE_TITLE = 'Sandboxes require an active Max plan'
export const SANDBOX_UPGRADE_DESCRIPTION =
  'Upgrade to Max and ensure billing is active to add dependencies, system packages, and managed CLI tools to Function blocks.'

/** Delete-confirmation copy, matching the custom tool detail's wording. Names the
 *  sandbox so the dialog is self-evidently about the one you opened it from. */
export function sandboxDeleteConfirmText(name: string) {
  return [
    'This will permanently delete ',
    { text: name, bold: true },
    {
      text: ' and remove it from any Function blocks that are using it.',
      error: true,
    },
    ' This action cannot be undone.',
  ]
}

/** Ordered to match the Function block's own `language` dropdown. */
export const LANGUAGE_OPTIONS = [
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python' },
] as const

export const CLI_TOOL_GROUPS = SANDBOX_CLI_TOOL_CATEGORIES.map((category) => ({
  section: category,
  items: SANDBOX_SELECTABLE_CLI_TOOL_IDS.filter(
    (id) => SANDBOX_CLI_TOOLS[id].category === category
  ).map((id) => ({
    value: id,
    label: SANDBOX_CLI_TOOLS[id].label,
    searchTerms: SANDBOX_CLI_TOOLS[id].searchTerms,
  })),
})).filter((group) => group.items.length > 0)

/**
 * Placeholders double as the format documentation, so they swap with the
 * language rather than describing one syntax for both.
 */
export const DEPENDENCY_PLACEHOLDERS: Record<SandboxLanguage, string> = {
  python: 'google-cloud-bigquery==3.25.0\npyairtable>=3.0\npandas',
  javascript: 'axios@^1.7.0\n@aws-sdk/client-s3\nzod',
}

export const SYSTEM_PACKAGE_PLACEHOLDER = 'shellcheck\npandoc\ngraphviz'

export interface SandboxDraft {
  name: string
  language: SandboxLanguage
  /** Raw textarea contents — one dependency per line, comments allowed. */
  dependencies: string
  /** Raw textarea contents — one Debian/APT package per line, comments allowed. */
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

export interface SandboxLineIssues {
  field: SandboxValidationError['issueField']
  issues: SandboxDependencyIssue[]
}

/**
 * Pulls the per-line rejections off a failed save. The server addresses each one
 * to the row the user typed it on, so they are surfaced against the textarea
 * rather than as a single opaque error.
 */
export function extractIssues(error: unknown): SandboxLineIssues | null {
  const body = (error as { body?: Partial<SandboxValidationError> })?.body
  if (!Array.isArray(body?.issues) || body.issues.length === 0) return null
  return {
    field: body.issueField === 'systemPackages' ? 'systemPackages' : 'dependencies',
    issues: body.issues,
  }
}
