/**
 * What each kind means outside its codec, in one record typed over every kind: the CLI's
 * `tsconfig.json` and agent guide, the keys a directory declares for `workspace.d.ts`, how
 * findings name a resource and which resource key table binds it all read it, so a new kind fails
 * to compile until each is stated.
 */
import type { ResourceKind } from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS, type WorkspaceKind } from './kind'

/**
 * How a kind's keys are spelled: a resource key (`isResourceKey`), a path under the kind's folder
 * (`isFileKey`), or a secret name (`isSecretName`).
 */
export type KeyShape = 'resource' | 'path' | 'secret-name'

/** One kind, as the directory's tooling and messages describe it. */
interface WorkspaceKindSpec {
  /** How findings and messages name one resource of the kind. */
  noun: string
  /** How its keys are spelled, which a base address's key is validated against. */
  keyShape: KeyShape
  /**
   * The resource kind its keys are recorded under in the workspace's key table
   * (`workspace_resource_key.kind`): the one a workflow names it by, and a write claims. `null` for
   * a kind with no key row of its own, which claims none: a secret (read by name as `env.NAME`), a
   * file (keyed by its path) or a deployment (keyed by its workflow's key).
   */
  resourceKind: ResourceKind | null
  /** The kind's TypeScript files as `tsconfig.json` `include` globs: what `tsc -p .` checks. */
  typeChecked: readonly string[]
  /**
   * The list of the SDK's workspace manifest a key the directory declares is typed through, so
   * `workspace.d.ts` knows it before it is applied; `null` for a kind workflows do not name by key.
   */
  manifestKey:
    | 'secretDeclarations'
    | 'credentialDeclarations'
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
  secret: {
    noun: 'secret',
    keyShape: 'secret-name',
    resourceKind: null,
    typeChecked: [KIND_DIRS.secret],
    manifestKey: 'secretDeclarations',
    guide: `\`${KIND_DIRS.secret}\`: \`export default defineSecrets({ NAME: { description? } })\`, the workspace secrets workflows read, by name and description only (never a value: set one with \`sim secrets set NAME --scope workspace\`). A workflow: \`env.NAME\`; one using a declared secret the workspace has no value for is held back, and the rest apply.`,
  },
  credential: {
    noun: 'credential',
    keyShape: 'resource',
    resourceKind: 'credential',
    typeChecked: [KIND_DIRS.credential],
    manifestKey: 'credentialDeclarations',
    guide: `\`${KIND_DIRS.credential}\`: \`export default defineCredentials({ <key>: { provider, name? } })\`, binding each key to this workspace's credential for that provider (never a token): the one bound already, else the only one, else the one whose display name is \`name\`. A workflow: \`credential('<key>')\`; one using a key no credential binds to is held back, and the rest apply.`,
  },
  'custom-tool': {
    noun: 'custom tool',
    keyShape: 'resource',
    resourceKind: 'custom-tool',
    typeChecked: [`${KIND_DIRS['custom-tool']}/*.ts`],
    manifestKey: 'customTools',
    guide: `\`${KIND_DIRS['custom-tool']}/<key>.ts\` (\`defineTool({ title, schema, code: codeFile('./<key>.js') })\`) and its code in \`${KIND_DIRS['custom-tool']}/<key>.js\`, where each schema parameter is a variable. Code holding a literal credential prints as \`code: stored()\`, which keeps the stored code. A workflow: \`customTool('<key>')\`.`,
  },
  skill: {
    noun: 'skill',
    keyShape: 'resource',
    resourceKind: 'skill',
    typeChecked: [],
    manifestKey: 'skills',
    guide: `\`${KIND_DIRS.skill}/<key>.md\`: a frontmatter block of \`name\` and \`description\`, then the content. A workflow: \`skills: [skill('<key>')]\` on an agent.`,
  },
  'mcp-server': {
    noun: 'MCP server',
    keyShape: 'resource',
    resourceKind: 'mcp-server',
    typeChecked: [`${KIND_DIRS['mcp-server']}/*.ts`],
    manifestKey: 'mcpServerDeclarations',
    guide: `\`${KIND_DIRS['mcp-server']}/<key>.ts\`: \`export default defineMcpServer({ name?, url, headers?, auth?, timeout?, retries?, enabled? })\`. A credential header holds \`env.NAME\` or \`'Bearer {{NAME}}'\`, never a literal secret; \`stored()\` keeps the value the server holds. A changed \`url\` replaces the server. A workflow: \`mcp('<key>').tool('<name>')\`.`,
  },
  table: {
    noun: 'table',
    keyShape: 'resource',
    resourceKind: 'table',
    typeChecked: [`${KIND_DIRS.table}/*.ts`],
    manifestKey: 'tableDeclarations',
    guide: `\`${KIND_DIRS.table}/<key>.ts\`: \`export default defineTable({ name, description?, folder?, columns: { … } })\` with \`column.string()\`, \`column.number()\`, \`column.select({ options: [...] })\`, … from \`@sim/workflow-sdk/workspace\`. Rows stay out of source unless \`rows\` opts in: \`{ mode: 'managed', key: '<unique column>' }\` keeps the rows equal to \`${KIND_DIRS.table}/<key>.rows.jsonl\` (one JSON object per line, keyed by column key), \`{ mode: 'seed' }\` writes them once into a new table. A workflow: \`table('<key>')\`.`,
  },
  'knowledge-base': {
    noun: 'knowledge base',
    keyShape: 'resource',
    resourceKind: 'knowledge-base',
    typeChecked: [`${KIND_DIRS['knowledge-base']}/*/knowledge.ts`],
    manifestKey: 'knowledgeBases',
    guide: `\`${KIND_DIRS['knowledge-base']}/<key>/knowledge.ts\` (\`defineKnowledgeBase({ name, description?, folder?, chunking?, embeddingModel? })\`) and \`${KIND_DIRS['knowledge-base']}/<key>/docs/\`, one file per document, flat. A workflow: \`knowledgeBase('<key>')\`. Connector-synced documents are never part of source.`,
  },
  file: {
    noun: 'file',
    keyShape: 'path',
    resourceKind: null,
    typeChecked: [],
    manifestKey: null,
    guide: `\`${KIND_DIRS.file}/<path>\`: every file is one workspace file at that folder path; no declaration.`,
  },
  workflow: {
    noun: 'workflow',
    keyShape: 'resource',
    resourceKind: 'workflow',
    typeChecked: [`${KIND_DIRS.workflow}/*/${SOURCE_ENTRY_FILE}`],
    manifestKey: 'workflows',
    guide: `\`${KIND_DIRS.workflow}/<key>/\`: one workflow each, exactly a \`sim workflows source get --dir\` directory (\`workflow.ts\`, \`functions/*\`, \`.sim/lock.json\`, \`.sim/base.json\`).`,
  },
  deployment: {
    noun: 'deployment',
    keyShape: 'resource',
    resourceKind: null,
    typeChecked: [`${KIND_DIRS.deployment}/*.ts`],
    manifestKey: null,
    guide: `\`${KIND_DIRS.deployment}/<workflow key>.ts\`: \`defineDeployment({ live: 'draft' | 'pinned', api?: { public? }, chat? })\` deploys \`${KIND_DIRS.workflow}/<workflow key>/\`, so its schedule, webhook, API and chat triggers run. \`live: 'draft'\` publishes the draft whenever it differs from the live version; \`'pinned'\` never redeploys and says when the draft differs. A chat password is \`env.NAME\` (or \`stored()\` to keep the stored one); chat outputs name a block by its name. Removing the file undeploys the workflow (needs \`--allow-delete\`). Deploying needs workspace admin, never a workspace API key. MCP publishing is not part of source.`,
  },
}
