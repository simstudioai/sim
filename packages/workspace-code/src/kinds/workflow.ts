/**
 * Workflows: each `workflows/<key>/` folder is a workflow source directory exactly as
 * `sim workflows source get --dir` writes it (`workflow.ts`, `functions/*`, `.sim/lock.json`,
 * `.sim/base.json`), so it also applies on its own with `sim workflows source apply`. The
 * workflow pipeline compiles and diffs it; this codec only carries the files.
 */
import { isRecordLike } from '@sim/utils/object'
import { type SourceBase, setOwn } from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { diagnostic, type WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec, type WorkspaceKind } from '../kind'
import { WORKFLOW_BASE_FILE, WORKFLOW_LOCK_FILE } from '../layout'
import { groupByFolder } from './group'

/** A workflow folder's files, as the workflow compiler reads them. */
export interface WorkflowDecl {
  /**
   * Files relative to the workflow folder: `workflow.ts` and its function code. Empty when the
   * folder was sent with only its base, meaning it is unchanged since the CLI last wrote it.
   */
  files: Record<string, string>
  /** `.sim/lock.json`, as JSON; the workflow pipeline validates it. */
  lock?: unknown
  /** `.sim/base.json`, as JSON: where the workflow was read. */
  base?: unknown
}

/** The folder of workflow `key`. */
export function workflowFolder(key: string): string {
  return `${KIND_DIRS.workflow}/${key}`
}

/** A workflow folder's base, when it is one (`SourceBase`: where the workflow was read). */
export function workflowSourceBase(decl: WorkflowDecl): SourceBase | null {
  const base = decl.base
  return isRecordLike(base) &&
    typeof base.workflowId === 'string' &&
    typeof base.workspaceId === 'string' &&
    typeof base.fingerprint === 'string' &&
    typeof base.catalogHash === 'string'
    ? {
        workflowId: base.workflowId,
        workspaceId: base.workspaceId,
        fingerprint: base.fingerprint,
        catalogHash: base.catalogHash,
      }
    : null
}

/** The SDK functions that name another kind's resource by key, and the kind each names. */
const REFERENCE_KINDS = {
  table: 'table',
  knowledgeBase: 'knowledge-base',
  customTool: 'custom-tool',
  skill: 'skill',
} as const satisfies Record<string, WorkspaceKind>

/** `table('leads')`, `skill("tone")`, …: a reference call with a literal key. */
const REFERENCE_CALL = new RegExp(
  `\\b(${Object.keys(REFERENCE_KINDS).join('|')})\\(\\s*(['"])([a-z][a-z0-9_-]{0,63})\\2`,
  'g'
)

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** The codec of `workflows/<key>/`: it carries the files; the workflow pipeline compiles them. */
export const workflowCodec: KindCodec<WorkflowDecl> = {
  group: (paths) => groupByFolder(KIND_DIRS.workflow, paths),
  parse(key, text) {
    const folder = `${workflowFolder(key)}/`
    const decl: WorkflowDecl = { files: {} }
    const diagnostics: WorkspaceDiagnostic[] = []
    for (const [path, content] of Object.entries(text)) {
      const relative = path.slice(folder.length)
      if (relative === WORKFLOW_LOCK_FILE || relative === WORKFLOW_BASE_FILE) {
        try {
          decl[relative === WORKFLOW_LOCK_FILE ? 'lock' : 'base'] = JSON.parse(content)
        } catch {
          diagnostics.push(
            diagnostic('E_DECL_SHAPE', `${path} is not valid JSON.`, { kind: 'workflow', key })
          )
        }
      } else if (!relative.startsWith('.sim/')) {
        setOwn(decl.files, relative, content)
      }
    }
    if (Object.keys(decl.files).length > 0 && !Object.hasOwn(decl.files, SOURCE_ENTRY_FILE)) {
      diagnostics.push(
        diagnostic('E_DECL_SHAPE', `${workflowFolder(key)} has no ${SOURCE_ENTRY_FILE}.`, {
          kind: 'workflow',
          key,
        })
      )
    }
    return diagnostics.length > 0 ? { diagnostics } : { decl, diagnostics }
  },
  print(key, decl) {
    const folder = workflowFolder(key)
    const text: Record<string, string> = {}
    for (const [path, content] of Object.entries(decl.files)) text[`${folder}/${path}`] = content
    if (decl.lock !== undefined) text[`${folder}/${WORKFLOW_LOCK_FILE}`] = json(decl.lock)
    if (decl.base !== undefined) text[`${folder}/${WORKFLOW_BASE_FILE}`] = json(decl.base)
    return { text, blobs: [] }
  },
  /** Workflows keep their own fingerprint (`sf1:`); this only tells two submissions apart. */
  canonical: (decl) => ({ files: decl.files }),
  /**
   * The resources `workflow.ts` names by literal key. A match inside a comment or string counts
   * too, which only ever makes a delete more cautious.
   */
  refs(decl) {
    const entry = decl.files[SOURCE_ENTRY_FILE] ?? ''
    const refs = new Map<string, { kind: WorkspaceKind; key: string }>()
    for (const match of entry.matchAll(REFERENCE_CALL)) {
      const kind = REFERENCE_KINDS[match[1] as keyof typeof REFERENCE_KINDS]
      refs.set(`${kind}:${match[3]}`, { kind, key: match[3] })
    }
    return [...refs.values()]
  },
}
