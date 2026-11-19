/**
 * Promotion: applying a directory read from one workspace (dev) to another (prod), binding its
 * resources by key there. The target's own get answer supplies everything that records ids (the
 * root base and each workflow folder's lock and base), so the target is planned exactly as an
 * edit of its own checkout would be: a resource the target holds under the same key is updated
 * in place (its ids, a workflow's block ids and so its webhook paths stay), a key it lacks is
 * created or adopted by name, and a change made in the target since its get is stale.
 *
 * Client-safe and pure: the CLI composes the submission, the server sees an ordinary apply.
 */
import { SOURCE_BASE_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { parseResourceAddress, type WorkspaceBaseV1 } from './base'
import { isFileKind, KIND_DIRS, type WorkspaceKind } from './kind'
import { fileKindGroupKey } from './kinds/entries'
import { FILE_KIND_CODECS, KIND_LAYOUTS } from './kinds/registry'
import { workflowFolder } from './kinds/workflow'
import { kindOfPath } from './layout'

/** What a promotion sends to the target, in place of the directory's own records. */
export interface PromotionSubmission {
  /** The directory's text files, each workflow folder whole, with the target's record files. */
  files: Record<string, string>
  /** The target's base, narrowed to what the directory declares unless deletes are allowed. */
  base: WorkspaceBaseV1
}

export interface PromotionInput {
  /** The directory's text files (path → text), every workflow folder sent whole. */
  files: Readonly<Record<string, string>>
  /** The directory's blob paths, which declare files and knowledge base documents. */
  blobPaths: readonly string[]
  /** The kinds the directory manages. */
  kinds: readonly WorkspaceKind[]
  /** The target's get answer for those kinds. */
  target: { files: Readonly<Record<string, string>>; base: WorkspaceBaseV1 }
  /**
   * Whether the promotion may delete what the target holds and the directory does not declare.
   * Without it, those resources leave the base, so the apply keeps them with a warning instead of
   * refusing for want of `--allow-delete`.
   */
  allowDelete: boolean
}

/** A workflow folder's record files: what binds it to one workspace's workflow and block ids. */
function isWorkflowRecord(path: string): boolean {
  if (kindOfPath(path) !== 'workflow') return false
  const relative = path.split('/').slice(2).join('/')
  return relative === SOURCE_LOCK_FILE || relative === SOURCE_BASE_FILE
}

/** The keys the directory declares for `kind`, from its paths or its root file. */
function declaredKeys(
  kind: WorkspaceKind,
  files: Readonly<Record<string, string>>,
  paths: readonly string[]
): Set<string> {
  if (!isFileKind(kind)) {
    return new Set(
      KIND_LAYOUTS[kind].group(paths.filter((path) => kindOfPath(path) === kind)).groups.keys()
    )
  }
  const file = KIND_DIRS[kind]
  const text = files[file]
  if (text === undefined) return new Set()
  const read = FILE_KIND_CODECS[kind].parse(fileKindGroupKey(kind), { [file]: text }, [])
  return new Set(read.decl ? Object.keys(read.decl) : [])
}

/**
 * The submission that promotes a directory to the target its get answer describes: the
 * directory's source with every workflow folder's lock and base replaced by the target's folder
 * of the same key (or dropped, so a key the target lacks creates a workflow), and the target's
 * base. Values never travel: secrets and credentials are names and keys the target binds to its
 * own.
 */
export function promotionSubmission(input: PromotionInput): PromotionSubmission {
  const files: Record<string, string> = {}
  for (const [path, text] of Object.entries(input.files)) {
    if (!isWorkflowRecord(path)) files[path] = text
  }
  const paths = [...Object.keys(files), ...input.blobPaths]
  const declared = new Map(
    input.kinds.map((kind) => [kind, declaredKeys(kind, files, paths)] as const)
  )
  for (const key of declared.get('workflow') ?? []) {
    for (const record of [SOURCE_LOCK_FILE, SOURCE_BASE_FILE]) {
      const path = `${workflowFolder(key)}/${record}`
      const text = input.target.files[path]
      if (text !== undefined) files[path] = text
    }
  }
  const resources = Object.fromEntries(
    Object.entries(input.target.base.resources).filter(([address]) => {
      const parsed = parseResourceAddress(address)
      if (!parsed) return false
      const keys = declared.get(parsed.kind)
      if (keys === undefined) return false
      return input.allowDelete || keys.has(parsed.key)
    })
  )
  return { files, base: { ...input.target.base, resources } }
}
