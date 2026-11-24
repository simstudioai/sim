/**
 * Promotion: applying a directory read from one workspace (dev) to another (prod), binding its
 * resources by key there. The target's own get answer supplies everything that records ids (the
 * root base and each workflow folder's lock and base), so the target is planned exactly as an
 * edit of its own checkout would be: a resource the target holds under the same key is updated
 * in place (its ids, a workflow's block ids and so its webhook paths stay), and a key it lacks is
 * created or adopted by name.
 *
 * What the target held after the last promotion from this directory is its
 * {@link PromotionRecord} (`.sim/targets/<workspaceId>.json`), and it is the base the three-way
 * rule compares with: a resource changed in the target since then is kept when the directory left
 * it alone and refused as stale when the directory changed it too. A resource the record does not
 * hold for the target's id (the first promotion, or one created there since) takes the target as
 * it stands.
 *
 * Client-safe and pure: the CLI composes the submission, the server sees an ordinary apply.
 */
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { parseSourceBase, sha256Hex, stableStringify } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import {
  type BaseResource,
  parseResourceAddress,
  parseWorkspaceBase,
  resourceAddress,
  type WorkspaceBaseV1,
} from './base'
import { isFileKind, KIND_DIRS, type WorkspaceKind } from './kind'
import { fileKindGroupKey } from './kinds/entries'
import { FILE_KIND_CODECS, KIND_LAYOUTS } from './kinds/registry'
import { workflowFolder } from './kinds/workflow'
import { kindOfPath } from './layout'

/** What a promotion sends to the target, in place of the directory's own records. */
export interface PromotionSubmission {
  /** The directory's text files, each workflow folder whole, with the target's record files. */
  files: Record<string, string>
  /**
   * The target's base, without what only the target holds unless its deletion is asked for (see
   * {@link PromotionInput.deleteTargetOnly}).
   */
  base: WorkspaceBaseV1
  /**
   * The resources (by address) the last promotion left in the target that the target deleted
   * since and the directory still declares: the apply keeps them deleted, so the promotion warns.
   */
  deletedInTarget: string[]
  /**
   * The resources (by address) the target holds that the directory does not declare and no
   * promotion from it left there: only the target ever held them. They are kept, and the server
   * names each (`W_UNDECLARED`), unless {@link PromotionInput.deleteTargetOnly}.
   */
  targetOnly: string[]
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
  /** What the last promotion from this directory left in the target, when one is recorded. */
  record?: PromotionRecord
  /**
   * Whether the promotion deletes what only the target holds (`--delete-target-only`, which the
   * apply's `--allow-delete` must accompany). Without it, those resources leave the base, so the
   * apply keeps them with a warning whether or not it allows deletes. A resource the last
   * promotion left that the directory no longer declares stays in the base either way: the
   * directory deleted it, which needs `--allow-delete` as an apply to its own workspace does.
   */
  deleteTargetOnly: boolean
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
 * `.sim/targets/<workspaceId>.json`: what one target workspace held after the last promotion from
 * this directory, so the next promotion compares with it rather than with the target as it is
 * read then (which would never look changed).
 */
export interface PromotionRecord {
  version: 1
  /** The target workspace. */
  workspaceId: string
  /** The target's root base entries after the last promotion, by resource address. */
  resources: WorkspaceBaseV1['resources']
  /** Each promoted workflow folder, by key. */
  workflows: Record<string, PromotedWorkflow>
}

/** A workflow folder as the last promotion left it in the target. */
interface PromotedWorkflow {
  /** The target's workflow id. */
  workflowId: string
  /** The target workflow's source fingerprint after the promotion (its folder base's). */
  fingerprint: string
  /** {@link folderDigest} of the directory's folder as promoted. */
  digest: string
}

/** The directory path of a target's promotion record. */
export function promotionRecordPath(workspaceId: string): string | null {
  return /^[A-Za-z0-9_-]{1,128}$/.test(workspaceId) ? `.sim/targets/${workspaceId}.json` : null
}

/** The digest of a workflow folder's source files (its records excluded), by path and text. */
function folderDigest(key: string, files: Readonly<Record<string, string>>): string {
  const prefix = `${workflowFolder(key)}/`
  const entries = Object.entries(files)
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).startsWith('.sim/'))
    .sort(([a], [b]) => compareStrings(a, b))
  return sha256Hex(stableStringify(entries))
}

/** A workflow folder base's text with `fingerprint` in place of its own, or `null` if unreadable. */
function withFingerprint(text: string, fingerprint: string): string | null {
  const parsed = parseSourceBase(text)
  if (!('base' in parsed)) return null
  return `${JSON.stringify({ ...parsed.base, fingerprint }, null, 2)}\n`
}

/**
 * The folder base of a workflow the last promotion left in target `workspaceId`, from its record:
 * it names that workflow and the fingerprint the promotion left. The catalog it was printed with
 * is not recorded, and a base naming a workflow the target no longer holds is never compiled.
 */
function recordedFolderBase(promoted: PromotedWorkflow, workspaceId: string): string {
  return `${JSON.stringify(
    {
      version: 1,
      workflowId: promoted.workflowId,
      workspaceId,
      fingerprint: promoted.fingerprint,
      catalogHash: '',
    },
    null,
    2
  )}\n`
}

/** The workflow a folder base's text names, or `null` if unreadable. */
function folderWorkflow(
  text: string | undefined
): { workflowId: string; fingerprint: string } | null {
  if (text === undefined) return null
  const parsed = parseSourceBase(text)
  return 'base' in parsed
    ? { workflowId: parsed.base.workflowId, fingerprint: parsed.base.fingerprint }
    : null
}

/**
 * Reads a promotion record for `workspaceId`; `undefined` for anything else (no record, another
 * target's, an unreadable one), which makes the promotion take the target as it stands.
 */
export function parsePromotionRecord(
  input: unknown,
  workspaceId: string
): PromotionRecord | undefined {
  if (!isRecordLike(input) || input.version !== 1 || input.workspaceId !== workspaceId) {
    return undefined
  }
  const base = parseWorkspaceBase({ version: 1, workspaceId, resources: input.resources }).base
  if (!base || !isRecordLike(input.workflows)) return undefined
  const workflows: Record<string, PromotedWorkflow> = {}
  for (const [key, entry] of Object.entries(input.workflows)) {
    if (
      !isRecordLike(entry) ||
      typeof entry.workflowId !== 'string' ||
      typeof entry.fingerprint !== 'string' ||
      typeof entry.digest !== 'string'
    ) {
      return undefined
    }
    workflows[key] = {
      workflowId: entry.workflowId,
      fingerprint: entry.fingerprint,
      digest: entry.digest,
    }
  }
  return { version: 1, workspaceId, resources: base.resources, workflows }
}

/**
 * The submission that promotes a directory to the target its get answer describes: the
 * directory's source with every workflow folder's lock and base replaced by the target's folder
 * of the same key (or dropped, so a key the target lacks creates a workflow), and the target's
 * base, without what only the target holds unless its deletion is asked for. With a
 * {@link PromotionRecord}, each entry the record holds for the same id stands in for the target's
 * own, and a workflow folder records the fingerprint the last promotion left: sent as its base
 * alone (a no-op) when the directory has not changed it since, else whole, so a target edit since
 * is refused as stale. Values never travel: secrets and credentials are names and keys the target
 * binds to its own.
 */
export function promotionSubmission(input: PromotionInput): PromotionSubmission {
  const files: Record<string, string> = {}
  const deletedInTarget: string[] = []
  for (const [path, text] of Object.entries(input.files)) {
    if (!isWorkflowRecord(path)) files[path] = text
  }
  const paths = [...Object.keys(files), ...input.blobPaths]
  const declared = new Map(
    input.kinds.map((kind) => [kind, declaredKeys(kind, files, paths)] as const)
  )
  for (const key of declared.get('workflow') ?? []) {
    const folder = workflowFolder(key)
    const basePath = `${folder}/${SOURCE_BASE_FILE}`
    const lockPath = `${folder}/${SOURCE_LOCK_FILE}`
    const targetBase = input.target.files[basePath]
    const live = folderWorkflow(targetBase)
    const promoted = input.record?.workflows[key]
    if (targetBase === undefined && promoted) {
      // Deleted in the target since the last promotion: the recorded base names the workflow it
      // left there, so the apply keeps the deletion, or refuses an edit since as stale.
      const unchanged = promoted.digest === folderDigest(key, input.files)
      if (unchanged) {
        for (const path of Object.keys(files)) {
          if (path.startsWith(`${folder}/`)) delete files[path]
        }
      }
      files[basePath] = recordedFolderBase(promoted, input.target.base.workspaceId)
      deletedInTarget.push(resourceAddress('workflow', key))
      continue
    }
    if (targetBase === undefined || !live || promoted?.workflowId !== live.workflowId) {
      for (const path of [basePath, lockPath]) {
        const text = input.target.files[path]
        if (text !== undefined) files[path] = text
      }
      continue
    }
    if (promoted.digest === folderDigest(key, input.files)) {
      for (const path of Object.keys(files)) {
        if (path.startsWith(`${folder}/`)) delete files[path]
      }
      files[basePath] = targetBase
      continue
    }
    files[basePath] = withFingerprint(targetBase, promoted.fingerprint) ?? targetBase
    const lock = input.target.files[lockPath]
    if (lock !== undefined) files[lockPath] = lock
  }
  const targetOnly: string[] = []
  const resources = Object.fromEntries(
    Object.entries(input.target.base.resources).flatMap(([address, live]) => {
      const parsed = parseResourceAddress(address)
      if (!parsed) return []
      const keys = declared.get(parsed.kind)
      if (keys === undefined) return []
      const recorded: BaseResource | undefined =
        input.record?.resources[resourceAddress(parsed.kind, parsed.key)]
      const promoted = recorded?.id === live.id ? recorded : undefined
      if (!keys.has(parsed.key) && !promoted) {
        targetOnly.push(resourceAddress(parsed.kind, parsed.key))
        if (!input.deleteTargetOnly) return []
      }
      return [[address, promoted ?? live] as const]
    })
  )
  // A resource the last promotion left in the target that the target no longer holds was deleted
  // there: its recorded entry stays in the base, so the apply keeps the deletion when the
  // directory left it alone and refuses an edit since as stale, rather than creating it again.
  for (const [address, recorded] of Object.entries(input.record?.resources ?? {})) {
    if (Object.hasOwn(input.target.base.resources, address)) continue
    const parsed = parseResourceAddress(address)
    if (parsed && declared.get(parsed.kind)?.has(parsed.key)) {
      resources[address] = recorded
      if (parsed.kind !== 'workflow') deletedInTarget.push(address)
    }
  }
  return {
    files,
    base: { ...input.target.base, resources },
    deletedInTarget: [...new Set(deletedInTarget)].sort(compareStrings),
    targetOnly: targetOnly.sort(compareStrings),
  }
}

/**
 * The record a promotion leaves for its target, from the apply's answer (`applied`: the target's
 * base after it, the files it reprinted, among them each written workflow folder's base, and its
 * plan). A resource's entry is the answer's base entry; a workflow folder's is what the apply
 * wrote, or what was sent whole and planned as a no-op, else the `previous` entry (a folder sent
 * as its base alone, or held back, or never reached). The record of a kind the promotion did not
 * manage is kept. A resource only the target held (`targetOnly`) is never recorded: a delete of it
 * the apply held back keeps its submitted base entry, and recording that would make the next
 * promotion read it as one the directory deleted.
 */
export function promotionRecord(input: {
  workspaceId: string
  previous: PromotionRecord | undefined
  kinds: readonly WorkspaceKind[]
  /** The directory's text files, as {@link PromotionInput} took them. */
  files: Readonly<Record<string, string>>
  submission: Pick<PromotionSubmission, 'files' | 'base' | 'targetOnly'>
  applied: {
    base: WorkspaceBaseV1
    files: Readonly<Record<string, string>>
    plan: ReadonlyArray<{ kind: string; key: string; action: string; held?: boolean }>
  }
}): PromotionRecord {
  const managed = new Set(input.kinds)
  const resources: WorkspaceBaseV1['resources'] = {}
  for (const [address, entry] of Object.entries(input.previous?.resources ?? {})) {
    const parsed = parseResourceAddress(address)
    if (parsed && !managed.has(parsed.kind)) {
      resources[resourceAddress(parsed.kind, parsed.key)] = entry
    }
  }
  const targetOnly = new Set(input.submission.targetOnly)
  for (const [address, entry] of Object.entries(input.applied.base.resources)) {
    const parsed = parseResourceAddress(address)
    if (parsed && !targetOnly.has(address)) {
      resources[resourceAddress(parsed.kind, parsed.key)] = entry
    }
  }
  const workflows: Record<string, PromotedWorkflow> = {}
  if (!managed.has('workflow')) {
    Object.assign(workflows, input.previous?.workflows)
    return { version: 1, workspaceId: input.workspaceId, resources, workflows }
  }
  const paths = Object.keys(input.files).filter((path) => kindOfPath(path) === 'workflow')
  for (const key of KIND_LAYOUTS.workflow.group(paths).groups.keys()) {
    const folder = `${workflowFolder(key)}/`
    const basePath = `${folder}${SOURCE_BASE_FILE}`
    const change = input.applied.plan.find(
      (planned) => planned.kind === 'workflow' && planned.key === key
    )
    const sentWhole = Object.keys(input.submission.files).some(
      (path) => path.startsWith(folder) && path !== basePath
    )
    const left =
      folderWorkflow(input.applied.files[basePath]) ??
      (sentWhole && change?.action === 'noop' && !change.held
        ? folderWorkflow(input.submission.files[basePath])
        : null)
    const previous = input.previous?.workflows[key]
    if (left) workflows[key] = { ...left, digest: folderDigest(key, input.files) }
    else if (previous) workflows[key] = previous
  }
  return { version: 1, workspaceId: input.workspaceId, resources, workflows }
}
