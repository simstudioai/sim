/**
 * `generateWorkspaceTypes(manifest)`: one `workspace.d.ts` that narrows the SDK to a workspace's
 * resources. It fills the `Workspace*` interfaces `core.d.ts` declares, so `table('leads')`
 * types its rows, a misspelled `knowledgeBase('dosc')` or `env.STRIPE_KYE` is an error, and so on. Written by
 * `sim workflows source get --dir` from the workspace source resources; without it every key is a
 * plain string.
 */

import { compareStrings } from '@sim/utils/string'
import { printKey, quoteString } from '@sim/workflow-code'
import { union } from './emit'
import type { SdkTypeFile } from './generate'

/** A table column, as the table's schema declares it (apps/sim/lib/table/column-types). */
export interface WorkspaceManifestColumn {
  /** The column type id: `string`, `number`, `currency`, `boolean`, `date`, `json`, `select`, ... */
  type: string
  /** Option values of a `select` column. */
  options?: string[]
}

/** The workspace resources the SDK can name, by stable key. */
export interface WorkspaceManifest {
  tables?: Record<string, { columns: Record<string, WorkspaceManifestColumn> }>
  knowledgeBases?: string[]
  /** Saved credentials, with the provider each one is for. */
  credentials?: Record<string, { provider: string }>
  /** Workflows by key, with the inputs their start block declares. */
  workflows?: Record<string, { inputs?: Record<string, string> }>
  /** Environment variable names (never values). */
  env?: string[]
}

export type GenerateWorkspaceTypesFn = (manifest: WorkspaceManifest) => SdkTypeFile

function columnType(column: WorkspaceManifestColumn): string {
  switch (column.type) {
    case 'number':
    case 'currency':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return 'Json'
    case 'select':
      return column.options && column.options.length > 0
        ? union(column.options.map((option) => quoteString(option)))
        : 'string'
    default:
      return 'string'
  }
}

function inputType(type: string): string {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'Json[]'
    case 'object':
      return 'Json'
    case 'file[]':
      return 'SimFile[]'
    default:
      return 'string'
  }
}

function sortedKeys(record: Record<string, unknown> | undefined): string[] {
  return Object.keys(record ?? {}).sort(compareStrings)
}

function interfaceBlock(name: string, members: readonly string[]): string[] {
  if (members.length === 0) return []
  return [`  interface ${name} {`, ...members.map((member) => `    ${member}`), '  }']
}

/** Generates `workspace.d.ts`. Deterministic: keys are sorted. */
export const generateWorkspaceTypes: GenerateWorkspaceTypesFn = (manifest) => {
  const tables = sortedKeys(manifest.tables).map((key) => {
    const columns = manifest.tables?.[key]?.columns ?? {}
    const fields = sortedKeys(columns).map(
      (column) => `${printKey(column)}: ${columnType(columns[column])}`
    )
    return `${quoteString(key)}: { ${fields.join('; ')} }`
  })
  const knowledgeBases = [...new Set(manifest.knowledgeBases ?? [])]
    .sort(compareStrings)
    .map((key) => `${quoteString(key)}: true`)
  const credentials = sortedKeys(manifest.credentials).map(
    (key) =>
      `${quoteString(key)}: { provider: ${quoteString(manifest.credentials?.[key]?.provider ?? '')} }`
  )
  const workflows = sortedKeys(manifest.workflows).map((key) => {
    const inputs = manifest.workflows?.[key]?.inputs ?? {}
    const fields = sortedKeys(inputs).map((name) => `${printKey(name)}: ${inputType(inputs[name])}`)
    return `${quoteString(key)}: { inputs: { ${fields.join('; ')} } }`
  })
  const env = [...new Set(manifest.env ?? [])]
    .sort(compareStrings)
    .map((name) => `${printKey(name)}: true`)
  const body = [
    ...interfaceBlock('WorkspaceTables', tables),
    ...interfaceBlock('WorkspaceKnowledgeBases', knowledgeBases),
    ...interfaceBlock('WorkspaceCredentials', credentials),
    ...interfaceBlock('WorkspaceWorkflows', workflows),
    ...interfaceBlock('WorkspaceEnv', env),
  ]
  const text = body.join('\n')
  const used = ['Json', 'SimFile'].filter((name) => new RegExp(`\\b${name}\\b`).test(text))
  return {
    path: 'workspace.d.ts',
    text: [
      '// @sim-sdk workspace · generated from the workspace resource manifest; do not edit',
      used.length > 0 ? `import type { ${used.join(', ')} } from '@sim/workflow-sdk'` : 'export {}',
      '',
      `declare module '@sim/workflow-sdk' {`,
      ...body,
      '}',
      '',
    ].join('\n'),
  }
}
