/**
 * Workflows: each `workflows/<key>/` folder is a workflow source directory exactly as
 * `sim workflows source get --dir` writes it (`workflow.ts`, `functions/*`, `.sim/lock.json`,
 * `.sim/base.json`), so it also applies on its own with `sim workflows source apply`. The
 * workflow pipeline compiles and diffs it; this codec only carries the files.
 */
import { parseSourceBase, type SourceBase, setOwn } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { diagnostic, type WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
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
  /** `.sim/base.json`: where the workflow was read. */
  base?: SourceBase
}

/** The folder of workflow `key`. */
export function workflowFolder(key: string): string {
  return `${KIND_DIRS.workflow}/${key}`
}

/** A workflow folder's base, when it has one (`SourceBase`: where the workflow was read). */
export function workflowSourceBase(decl: WorkflowDecl): SourceBase | null {
  return decl.base ?? null
}

/**
 * What workflow folder `key` is sent as when every file is as the CLI last wrote it: its base
 * alone, which the codec reads back as unchanged (`isUnchanged`), so the server never evaluates
 * it. Only a folder read from `workspaceId`, the workspace applied to, is sent that way: anywhere
 * else its base names no workflow, so the folder is sent whole and the apply creates it there.
 * `text` is the folder's files by workspace path.
 */
export function unchangedFiles(
  key: string,
  text: Readonly<Record<string, string>>,
  workspaceId: string
): Record<string, string> {
  const basePath = `${workflowFolder(key)}/${SOURCE_BASE_FILE}`
  const baseText = text[basePath]
  if (baseText === undefined) return { ...text }
  const base = parseSourceBase(baseText)
  return 'base' in base && base.base.workspaceId === workspaceId
    ? { [basePath]: baseText }
    : { ...text }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** The codec of `workflows/<key>/`: it carries the files; the workflow pipeline compiles them. */
export const workflowCodec: KindCodec<WorkflowDecl> = {
  budget: 'workflow',
  isUnchanged: (decl) => Object.keys(decl.files).length === 0,
  group: (paths) => groupByFolder(KIND_DIRS.workflow, paths),
  parse(key, text) {
    const folder = `${workflowFolder(key)}/`
    const decl: WorkflowDecl = { files: {} }
    const diagnostics: WorkspaceDiagnostic[] = []
    for (const [path, content] of Object.entries(text)) {
      const relative = path.slice(folder.length)
      if (relative === SOURCE_LOCK_FILE) {
        try {
          decl.lock = JSON.parse(content)
        } catch {
          diagnostics.push(
            diagnostic('E_DECL_SHAPE', `${path} is not valid JSON.`, { kind: 'workflow', key })
          )
        }
      } else if (relative === SOURCE_BASE_FILE) {
        const base = parseSourceBase(content)
        if ('base' in base) decl.base = base.base
        else {
          diagnostics.push(
            diagnostic('E_DECL_SHAPE', `${path} is not a workflow base. ${base.problem}`, {
              kind: 'workflow',
              key,
            })
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
    if (decl.lock !== undefined) text[`${folder}/${SOURCE_LOCK_FILE}`] = json(decl.lock)
    if (decl.base !== undefined) text[`${folder}/${SOURCE_BASE_FILE}`] = json(decl.base)
    return { text, blobs: [] }
  },
  /** Workflows keep their own fingerprint (`sf1:`); this only tells two submissions apart. */
  canonical: (decl) => ({ files: decl.files }),
}
