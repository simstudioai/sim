/**
 * What each kind means outside its codec, in one record typed over every kind: the CLI's
 * `tsconfig.json` and agent guide, the keys a directory declares for `workspace.d.ts`, how
 * findings name a resource and which resource key table binds it all read it, so a new kind fails
 * to compile until each is stated.
 */
import type { ResourceKind } from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS, type WorkspaceKind } from './kind'

/** One kind, as the directory's tooling and messages describe it. */
interface WorkspaceKindSpec {
  /** How findings and messages name one resource of the kind. */
  noun: string
  /**
   * The resource kind whose keys name the kind's resources (`workspace_resource_key.kind`), which
   * a write claims; `null` for a kind keyed by another kind's keys (a deployment, by its
   * workflow's) or by path (a file), which claims none.
   */
  resourceKind: ResourceKind | null
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
    | 'workflows'
    | null
  /** The kind's entry in the directory's agent guide: its files, and how a workflow names one. */
  guide: string
}

/** Every kind's {@link WorkspaceKindSpec}. */
export const WORKSPACE_KIND_SPECS: { readonly [K in WorkspaceKind]: WorkspaceKindSpec } = {
  'custom-tool': {
    noun: 'custom tool',
    resourceKind: 'custom-tool',
    typeChecked: [`${KIND_DIRS['custom-tool']}/*.ts`],
    manifestKey: 'customTools',
    guide: `\`${KIND_DIRS['custom-tool']}/<key>.ts\` (\`defineTool({ title, schema, code: codeFile('./<key>.js') })\`) and its code in \`${KIND_DIRS['custom-tool']}/<key>.js\`, where each schema parameter is a variable. A workflow: \`customTool('<key>')\`.`,
  },
  skill: {
    noun: 'skill',
    resourceKind: 'skill',
    typeChecked: [],
    manifestKey: 'skills',
    guide: `\`${KIND_DIRS.skill}/<key>.md\`: a frontmatter block of \`name\` and \`description\`, then the content. A workflow: \`skills: [skill('<key>')]\` on an agent.`,
  },
  table: {
    noun: 'table',
    resourceKind: 'table',
    typeChecked: [`${KIND_DIRS.table}/*.ts`],
    manifestKey: 'tableDeclarations',
    guide: `\`${KIND_DIRS.table}/<key>.ts\`: \`export default defineTable({ name, description?, folder?, columns: { … } })\` with \`column.string()\`, \`column.number()\`, \`column.select({ options: [...] })\`, … from \`@sim/workflow-sdk/workspace\`. Rows are never part of source. A workflow: \`table('<key>')\`.`,
  },
  'knowledge-base': {
    noun: 'knowledge base',
    resourceKind: 'knowledge-base',
    typeChecked: [`${KIND_DIRS['knowledge-base']}/*/knowledge.ts`],
    manifestKey: 'knowledgeBases',
    guide: `\`${KIND_DIRS['knowledge-base']}/<key>/knowledge.ts\` (\`defineKnowledgeBase({ name, description?, folder?, chunking?, embeddingModel? })\`) and \`${KIND_DIRS['knowledge-base']}/<key>/docs/\`, one file per document, flat. A workflow: \`knowledgeBase('<key>')\`. Connector-synced documents are never part of source.`,
  },
  file: {
    noun: 'file',
    resourceKind: null,
    typeChecked: [],
    manifestKey: null,
    guide: `\`${KIND_DIRS.file}/<path>\`: every file is one workspace file at that folder path; no declaration.`,
  },
  workflow: {
    noun: 'workflow',
    resourceKind: 'workflow',
    typeChecked: [`${KIND_DIRS.workflow}/*/${SOURCE_ENTRY_FILE}`],
    manifestKey: 'workflows',
    guide: `\`${KIND_DIRS.workflow}/<key>/\`: one workflow each, exactly a \`sim workflows source get --dir\` directory (\`workflow.ts\`, \`functions/*\`, \`.sim/lock.json\`, \`.sim/base.json\`).`,
  },
  deployment: {
    noun: 'deployment',
    resourceKind: null,
    typeChecked: [`${KIND_DIRS.deployment}/*.ts`],
    manifestKey: null,
    guide: `\`${KIND_DIRS.deployment}/<workflow key>.ts\`: \`defineDeployment({ live: 'draft' | 'pinned', api?: { public? }, chat? })\` deploys \`${KIND_DIRS.workflow}/<workflow key>/\`, so its schedule, webhook, API and chat triggers run. \`live: 'draft'\` publishes the draft whenever it differs from the live version; \`'pinned'\` never redeploys and says when the draft differs. A chat password is \`env.NAME\` (or \`stored()\` to keep the stored one); chat outputs name a block by its name. Removing the file undeploys the workflow (needs \`--allow-delete\`). Deploying needs workspace admin, never a workspace API key. MCP publishing is not part of source.`,
  },
}
