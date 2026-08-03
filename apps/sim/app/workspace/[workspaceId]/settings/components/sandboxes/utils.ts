import type { Sandbox, SandboxDependencyIssue } from '@/lib/api/contracts/sandboxes'

export type SandboxLanguage = Sandbox['language']

/** Shared by the settings page and the picker's create modal so the wall reads identically. */
export const SANDBOX_UPGRADE_TITLE = 'Sandboxes require an active Max plan'
export const SANDBOX_UPGRADE_DESCRIPTION =
  'Upgrade to Max and ensure billing is active to install Python or npm packages that your Function blocks can import.'

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

/**
 * Placeholders double as the format documentation, so they swap with the
 * language rather than describing one syntax for both.
 */
export const DEPENDENCY_PLACEHOLDERS: Record<SandboxLanguage, string> = {
  python: 'google-cloud-bigquery==3.25.0\npyairtable>=3.0\npandas',
  javascript: 'axios@^1.7.0\n@aws-sdk/client-s3\nzod',
}

export interface SandboxDraft {
  name: string
  language: SandboxLanguage
  /** Raw textarea contents — one dependency per line, comments allowed. */
  dependencies: string
}

export function draftFromSandbox(sandbox: Sandbox): SandboxDraft {
  return {
    name: sandbox.name,
    language: sandbox.language,
    dependencies: sandbox.dependencies.join('\n'),
  }
}

/** Defaults to the Function block's own default language so the two agree. */
export function emptyDraft(): SandboxDraft {
  return { name: '', language: 'javascript', dependencies: '' }
}

/** Splits the textarea into one entry per row so a rejection keeps its line number. */
export function toSubmittedLines(dependencies: string): string[] {
  return dependencies.split('\n')
}

/**
 * Pulls the per-line rejections off a failed save. The server addresses each one
 * to the row the user typed it on, so they are surfaced against the textarea
 * rather than as a single opaque error.
 */
export function extractIssues(error: unknown): SandboxDependencyIssue[] {
  const issues = (error as { body?: { issues?: SandboxDependencyIssue[] } })?.body?.issues
  return Array.isArray(issues) ? issues : []
}
