/**
 * `generateWorkspaceTypes(manifest)`: one `workspace.d.ts` that narrows the SDK to a workspace's
 * resources. It fills the `Workspace*` interfaces `core.d.ts` declares, so `table('leads')` types
 * its rows, a misspelled `knowledgeBase('dosc')`, `skill('tirage')` or `env.STRIPE_KYE` is an
 * error, and so on.
 * Written by `sim workflows source get --dir` from the workspace source resources; without it
 * every key is a plain string.
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
  /**
   * Keys of the tables a workspace source directory declares (`tables/<key>.ts`), as the CLI
   * listed them when it wrote this file (a get). Each is typed from its declaration
   * (`RowOf<typeof import('../../tables/<key>').default>`), so its row type follows an edit of its
   * columns without regenerating the file, and it replaces a stored table of the same key. A
   * table declared after the file was written is not typed until the next get.
   */
  tableDeclarations?: string[]
  knowledgeBases?: string[]
  /** Saved credentials, with the provider each one is for. */
  credentials?: Record<string, { provider: string }>
  /** Workflows by key, with the inputs their start block declares. */
  workflows?: Record<string, { inputs?: Record<string, string> }>
  /** Workspace skills by key. */
  skills?: string[]
  /** Workspace custom tools by key. */
  customTools?: string[]
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

/** Each key once, sorted, as a `'key': true` member. */
function keyMembers(keys: readonly string[] | undefined): string[] {
  return [...new Set(keys ?? [])].sort(compareStrings).map((key) => `${quoteString(key)}: true`)
}

function interfaceBlock(name: string, members: readonly string[]): string[] {
  if (members.length === 0) return []
  return [`  interface ${name} {`, ...members.map((member) => `    ${member}`), '  }']
}

/** Generates `workspace.d.ts`. Deterministic: keys are sorted. */
export const generateWorkspaceTypes: GenerateWorkspaceTypesFn = (manifest) => {
  const declared = [...new Set(manifest.tableDeclarations ?? [])].sort(compareStrings)
  const declaredTables = declared.map(
    (key) =>
      `${quoteString(key)}: RowOf<typeof import(${quoteString(`../../tables/${key}`)}).default>`
  )
  const storedTables = sortedKeys(manifest.tables).filter((key) => !declared.includes(key))
  const tables = storedTables.map((key) => {
    const columns = manifest.tables?.[key]?.columns ?? {}
    const fields = sortedKeys(columns).map(
      (column) => `${printKey(column)}: ${columnType(columns[column])}`
    )
    return `${quoteString(key)}: { ${fields.join('; ')} }`
  })
  const knowledgeBases = keyMembers(manifest.knowledgeBases)
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
    ...interfaceBlock('WorkspaceTables', [...declaredTables, ...tables]),
    ...interfaceBlock('WorkspaceKnowledgeBases', knowledgeBases),
    ...interfaceBlock('WorkspaceCredentials', credentials),
    ...interfaceBlock('WorkspaceWorkflows', workflows),
    ...interfaceBlock('WorkspaceSkills', keyMembers(manifest.skills)),
    ...interfaceBlock('WorkspaceCustomTools', keyMembers(manifest.customTools)),
    ...interfaceBlock('WorkspaceEnv', env),
  ]
  const text = body.join('\n')
  const used = ['Json', 'SimFile'].filter((name) => new RegExp(`\\b${name}\\b`).test(text))
  return {
    path: 'workspace.d.ts',
    text: [
      '// @sim-sdk workspace · generated from the workspace resource manifest; do not edit',
      used.length > 0 ? `import type { ${used.join(', ')} } from '@sim/workflow-sdk'` : 'export {}',
      ...(declared.length > 0 ? ["import type { RowOf } from '@sim/workflow-sdk/workspace'"] : []),
      '',
      `declare module '@sim/workflow-sdk' {`,
      ...body,
      '}',
      '',
    ].join('\n'),
  }
}
