/**
 * Workflows: each `workflows/<key>/` folder is a workflow source directory exactly as
 * `sim workflows source get --dir` writes it (`workflow.ts`, `functions/*`, `.sim/lock.json`,
 * `.sim/base.json`), so it also applies on its own with `sim workflows source apply`. The
 * workflow pipeline compiles and diffs it; this codec only carries the files.
 */
import { isRecordLike } from '@sim/utils/object'
import type { Json } from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { diagnostic, type WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { WORKFLOW_BASE_FILE, WORKFLOW_LOCK_FILE } from '../layout'
import { groupByFolder } from './group'

export interface WorkflowDecl {
  /**
   * Files relative to the workflow folder: `workflow.ts` and its function code. Empty when the
   * folder was sent with only its base, meaning it is unchanged since the CLI last wrote it.
   */
  files: Record<string, string>
  /** `.sim/lock.json`, as JSON. */
  lock?: Json
  /** `.sim/base.json`, as JSON: where the workflow was read. */
  base?: Json
}

/** The folder of workflow `key`. */
export function workflowFolder(key: string): string {
  return `${KIND_DIRS.workflow}/${key}`
}

/** The ids a workflow folder's base names, when it names them. */
export function workflowBaseIds(
  decl: WorkflowDecl
): { workflowId: string; workspaceId: string } | null {
  const base = decl.base
  return isRecordLike(base) &&
    typeof base.workflowId === 'string' &&
    typeof base.workspaceId === 'string'
    ? { workflowId: base.workflowId, workspaceId: base.workspaceId }
    : null
}

function json(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export const workflowCodec: KindCodec<WorkflowDecl> = {
  kind: 'workflow',
  dir: KIND_DIRS.workflow,
  group: (paths) => groupByFolder(KIND_DIRS.workflow, paths),
  parse(key, text) {
    const folder = `${workflowFolder(key)}/`
    const decl: WorkflowDecl = { files: {} }
    const diagnostics: WorkspaceDiagnostic[] = []
    for (const [path, content] of Object.entries(text)) {
      const relative = path.slice(folder.length)
      if (relative === WORKFLOW_LOCK_FILE || relative === WORKFLOW_BASE_FILE) {
        try {
          decl[relative === WORKFLOW_LOCK_FILE ? 'lock' : 'base'] = JSON.parse(content) as Json
        } catch {
          diagnostics.push(
            diagnostic('E_DECL_SHAPE', `${path} is not valid JSON.`, { kind: 'workflow', key })
          )
        }
      } else if (!relative.startsWith('.sim/')) {
        decl.files[relative] = content
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
  canonical: (decl) => ({ files: decl.files, lock: decl.lock ?? null }),
}
