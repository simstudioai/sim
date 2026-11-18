/**
 * What each kind means outside its codec, in one record typed over every kind: the CLI's
 * `tsconfig.json` and agent guide, the keys a directory declares for `workspace.d.ts`, and how
 * findings name a resource all read it, so a new kind fails to compile until each is stated.
 */
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS, type WorkspaceKind } from './kind'

/** One kind, as the directory's tooling and messages describe it. */
interface WorkspaceKindSpec {
  /** How findings and messages name one resource of the kind. */
  noun: string
  /** The kind's TypeScript files as `tsconfig.json` `include` globs: what `tsc -p .` checks. */
  typeChecked: readonly string[]
  /**
   * The list of the SDK's workspace manifest a key the directory declares is typed through, so
   * `workspace.d.ts` knows it before it is applied; `null` for a kind workflows do not name by key.
   */
  manifestKey:
    | 'tableDeclarations'
    | 'knowledgeBases'
    | 'customTools'
    | 'skills'
    | 'mcpServerDeclarations'
    | 'workflows'
    | null
  /** The kind's entry in the directory's agent guide: its files, and how a workflow names one. */
  guide: string
}

/** Every kind's {@link WorkspaceKindSpec}. */
export const WORKSPACE_KIND_SPECS: { readonly [K in WorkspaceKind]: WorkspaceKindSpec } = {
  'custom-tool': {
    noun: 'custom tool',
    typeChecked: [`${KIND_DIRS['custom-tool']}/*.ts`],
    manifestKey: 'customTools',
    guide: `\`${KIND_DIRS['custom-tool']}/<key>.ts\` (\`defineTool({ title, schema, code: codeFile('./<key>.js') })\`) and its code in \`${KIND_DIRS['custom-tool']}/<key>.js\`, where each schema parameter is a variable. A workflow: \`customTool('<key>')\`.`,
  },
  skill: {
    noun: 'skill',
    typeChecked: [],
    manifestKey: 'skills',
    guide: `\`${KIND_DIRS.skill}/<key>.md\`: a frontmatter block of \`name\` and \`description\`, then the content. A workflow: \`skills: [skill('<key>')]\` on an agent.`,
  },
  'mcp-server': {
    noun: 'MCP server',
    typeChecked: [`${KIND_DIRS['mcp-server']}/*.ts`],
    manifestKey: 'mcpServerDeclarations',
    guide: `\`${KIND_DIRS['mcp-server']}/<key>.ts\`: \`export default defineMcpServer({ name?, url, headers?, auth?, timeout?, retries?, enabled? })\`. A credential header holds \`env.NAME\` or \`'Bearer {{NAME}}'\`, never a literal secret; \`stored()\` keeps the value the server holds. A changed \`url\` replaces the server. A workflow: \`mcp('<key>').tool('<name>')\`.`,
  },
  table: {
    noun: 'table',
    typeChecked: [`${KIND_DIRS.table}/*.ts`],
    manifestKey: 'tableDeclarations',
    guide: `\`${KIND_DIRS.table}/<key>.ts\`: \`export default defineTable({ name, description?, folder?, columns: { … } })\` with \`column.string()\`, \`column.number()\`, \`column.select({ options: [...] })\`, … from \`@sim/workflow-sdk/workspace\`. Rows are never part of source. A workflow: \`table('<key>')\`.`,
  },
  'knowledge-base': {
    noun: 'knowledge base',
    typeChecked: [`${KIND_DIRS['knowledge-base']}/*/knowledge.ts`],
    manifestKey: 'knowledgeBases',
    guide: `\`${KIND_DIRS['knowledge-base']}/<key>/knowledge.ts\` (\`defineKnowledgeBase({ name, description?, folder?, chunking?, embeddingModel? })\`) and \`${KIND_DIRS['knowledge-base']}/<key>/docs/\`, one file per document, flat. A workflow: \`knowledgeBase('<key>')\`. Connector-synced documents are never part of source.`,
  },
  file: {
    noun: 'file',
    typeChecked: [],
    manifestKey: null,
    guide: `\`${KIND_DIRS.file}/<path>\`: every file is one workspace file at that folder path; no declaration.`,
  },
  workflow: {
    noun: 'workflow',
    typeChecked: [`${KIND_DIRS.workflow}/*/${SOURCE_ENTRY_FILE}`],
    manifestKey: 'workflows',
    guide: `\`${KIND_DIRS.workflow}/<key>/\`: one workflow each, exactly a \`sim workflows source get --dir\` directory (\`workflow.ts\`, \`functions/*\`, \`.sim/lock.json\`, \`.sim/base.json\`).`,
  },
}
