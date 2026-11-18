/**
 * `generateWorkspaceTypes(manifest)`: one `workspace.d.ts` that narrows the SDK to a workspace's
 * resources. It fills the `Workspace*` interfaces `core.d.ts` declares, so `table('leads')` types
 * its rows, a misspelled `knowledgeBase('dosc')`, `skill('tirage')`, `mcp('github').tool('crate_issue')`
 * or `env.STRIPE_KYE` is an error, and so on.
 * Written by `sim workflows source get --dir` from the workspace source resources; without it
 * every key is a plain string.
 */

import { compareStrings } from '@sim/utils/string'
import { printKey, quoteString } from '@sim/workflow-code'
import { arrayOf, union } from './emit'
import type { SdkTypeFile } from './generate'

/** A table column, as the table's schema declares it (apps/sim/lib/table/column-types). */
export interface WorkspaceManifestColumn {
  /** The column type id: `string`, `number`, `currency`, `boolean`, `date`, `json`, `select`, ... */
  type: string
  /** Option names of a `select` column, as table blocks read and write them. */
  options?: string[]
  /** A `select` column whose cells hold several options. */
  multiple?: boolean
  /** Every row holds a value; a cell of any other column may be empty (`null`). */
  required?: boolean
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
  /**
   * The keys `credentials.ts` declared when the CLI wrote this file (a get), present when the
   * directory has the file. Every key the file declares now types (`DeclaredCredentials<typeof
   * import('../../credentials').default>`), so a key added since the get type-checks before it is
   * applied; a stored credential under one of these keys is left out, so the declared provider
   * wins.
   */
  credentialDeclarations?: string[]
  /**
   * The names `secrets.ts` declared when the CLI wrote this file, present when the directory has
   * the file. Every name the file declares now types as `env.NAME`, beside the stored ones.
   */
  secretDeclarations?: string[]
  /** Workflows by key, with the inputs their start block declares. */
  workflows?: Record<string, { inputs?: Record<string, string> }>
  /** Workspace skills by key. */
  skills?: string[]
  /** Workspace custom tools by key. */
  customTools?: string[]
  /**
   * MCP servers by key, with the tool names the server listed when the manifest was read; a server
   * listed without `tools` (unreachable, or not listable by the caller) takes any tool name.
   */
  mcpServers?: Record<string, { tools?: string[] }>
  /**
   * Keys of the MCP servers a workspace source directory declares (`mcp/<key>.ts`), typed beside
   * the stored ones; one not stored yet takes any tool name until it is applied and read again.
   */
  mcpServerDeclarations?: string[]
  /** Environment variable names (never values). */
  env?: string[]
}

export type GenerateWorkspaceTypesFn = (manifest: WorkspaceManifest) => SdkTypeFile

/** A cell's type: its value, or `null` when the column is not required. */
function cellType(column: WorkspaceManifestColumn): string {
  const value = valueType(column)
  return column.required ? value : `${value} | null`
}

function valueType(column: WorkspaceManifestColumn): string {
  switch (column.type) {
    case 'number':
    case 'currency':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return 'Json'
    case 'select': {
      const option =
        column.options && column.options.length > 0
          ? union(column.options.map((name) => quoteString(name)))
          : 'string'
      return column.multiple ? arrayOf(option) : option
    }
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

function interfaceBlock(name: string, members: readonly string[], extendsType?: string): string[] {
  if (extendsType !== undefined) {
    return [
      `  interface ${name} extends ${extendsType} {`,
      ...members.map((member) => `    ${member}`),
      '  }',
    ]
  }
  if (members.length === 0) return []
  return [`  interface ${name} {`, ...members.map((member) => `    ${member}`), '  }']
}

/** `Helper<typeof import('../../<file>').default>`: a root declaration file's type, live. */
function declaredFileType(helper: string, file: string): string {
  return `${helper}<typeof import(${quoteString(`../../${file}`)}).default>`
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
      (column) => `${printKey(column)}: ${cellType(columns[column])}`
    )
    return `${quoteString(key)}: { ${fields.join('; ')} }`
  })
  const knowledgeBases = keyMembers(manifest.knowledgeBases)
  const declaredCredentials = new Set(manifest.credentialDeclarations ?? [])
  const credentials = sortedKeys(manifest.credentials)
    .filter((key) => !declaredCredentials.has(key))
    .map(
      (key) =>
        `${quoteString(key)}: { provider: ${quoteString(manifest.credentials?.[key]?.provider ?? '')} }`
    )
  const workflows = sortedKeys(manifest.workflows).map((key) => {
    const inputs = manifest.workflows?.[key]?.inputs ?? {}
    const fields = sortedKeys(inputs).map((name) => `${printKey(name)}: ${inputType(inputs[name])}`)
    return `${quoteString(key)}: { inputs: { ${fields.join('; ')} } }`
  })
  const mcpServers = [
    ...new Set([...sortedKeys(manifest.mcpServers), ...(manifest.mcpServerDeclarations ?? [])]),
  ]
    .sort(compareStrings)
    .map((key) => {
      const tools = [...new Set(manifest.mcpServers?.[key]?.tools ?? [])].sort(compareStrings)
      const names = tools.length > 0 ? union(tools.map((name) => quoteString(name))) : 'string'
      return `${quoteString(key)}: { tools: ${names} }`
    })
  const env = [...new Set(manifest.env ?? [])]
    .sort(compareStrings)
    .map((name) => `${printKey(name)}: true`)
  const body = [
    ...interfaceBlock('WorkspaceTables', [...declaredTables, ...tables]),
    ...interfaceBlock('WorkspaceKnowledgeBases', knowledgeBases),
    ...interfaceBlock(
      'WorkspaceCredentials',
      credentials,
      manifest.credentialDeclarations
        ? declaredFileType('DeclaredCredentials', 'credentials')
        : undefined
    ),
    ...interfaceBlock('WorkspaceWorkflows', workflows),
    ...interfaceBlock('WorkspaceSkills', keyMembers(manifest.skills)),
    ...interfaceBlock('WorkspaceCustomTools', keyMembers(manifest.customTools)),
    ...interfaceBlock('WorkspaceMcpServers', mcpServers),
    ...interfaceBlock(
      'WorkspaceEnv',
      env,
      manifest.secretDeclarations ? declaredFileType('DeclaredSecretNames', 'secrets') : undefined
    ),
  ]
  const text = body.join('\n')
  const used = ['Json', 'SimFile'].filter((name) => new RegExp(`\\b${name}\\b`).test(text))
  const workspaceImports = ['DeclaredCredentials', 'DeclaredSecretNames', 'RowOf'].filter((name) =>
    new RegExp(`\\b${name}<`).test(text)
  )
  return {
    path: 'workspace.d.ts',
    text: [
      '// @sim-sdk workspace · generated from the workspace resource manifest; do not edit',
      used.length > 0 ? `import type { ${used.join(', ')} } from '@sim/workflow-sdk'` : 'export {}',
      ...(workspaceImports.length > 0
        ? [`import type { ${workspaceImports.join(', ')} } from '@sim/workflow-sdk/workspace'`]
        : []),
      '',
      `declare module '@sim/workflow-sdk' {`,
      ...body,
      '}',
      '',
    ].join('\n'),
  }
}
