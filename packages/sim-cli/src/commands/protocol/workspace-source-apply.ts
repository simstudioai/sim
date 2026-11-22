import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecordLike } from '@sim/utils/object'
import { SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import {
  APPLY_ORDER,
  isFileKind,
  KIND_DIRS,
  parseResourceAddress,
  parseWorkspaceBase,
  resourceAddress,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isBlobPath, KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { workflowFolder } from '@sim/workspace-code/kinds/workflow'
import { kindOfPath, WORKSPACE_BASE_FILE } from '@sim/workspace-code/layout'
import {
  type PromotionRecord,
  parsePromotionRecord,
  promotionRecord,
  promotionRecordPath,
  promotionSubmission,
} from '@sim/workspace-code/promote'
import { serverResourceChanges } from '@sim/workspace-code/status'
import type { Command } from 'commander'
import { appendStepSummary } from '#sim-cli/output/github-actions'
import { printError } from '#sim-cli/output/io'
import { setSoftExitCode } from '../../embed-context'
import { SOURCE_HELD_EXIT_CODE, SOURCE_PARTIAL_EXIT_CODE } from '../../exit-codes'
import type {
  ApplyWorkspaceSourceBody,
  ApplyWorkspaceSourceResponse,
  GetWorkspaceSourceResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { safeOneLine } from '../../output/render'
import { apiCommand, type OperationClient } from '../../runtime/called-operations'
import { searchTasks } from '../search'
import { type DeployedUrl, deployedUrls, deployedUrlsText, lockBlockNames } from './deployed-urls'
import { gitProvenance } from './git-provenance'
import { CliUsageError, SourceDirError } from './local-errors'
import { printProtocolResult } from './result'
import {
  absoluteDirOption,
  directoryWorkspace,
  isMissing,
  orphanedCodeFiles,
  readSourceJson,
  readSourceText,
  readWritten,
  recordedStats,
  updateSourceDir,
  type Written,
  withSourceDirLock,
  writtenFiles,
  writtenRecord,
} from './source-dir'
import { SOURCE_WRITE_EXIT_CODES_HELP, sourceExitCodesHelp } from './source-exit-codes'
import { destructiveChanges } from './source-status'
import { cachedCatalog } from './source-tree'
import {
  createdText,
  findingsOutput,
  printRefusal,
  refusedExitCode,
  shellWord,
  verboseFlag,
  writeMode,
} from './source-ui'
import { type NextStep, runSourceWrite } from './source-write'
import {
  removedWorkflowRecords,
  unrecordedFoldersWarning,
  workflowFolderRecords,
} from './stored-edges'
import {
  appliedBlobDigests,
  assertBlobsFetched,
  baseBlobDigests,
  blobsToStage,
  stageBlobs,
} from './workspace-source-blobs'
import {
  assertWorkspaceDir,
  assertWorkspacePaths,
  ONLY_KINDS_HELP,
  parseKinds,
  readWorkspaceDir,
  toolOfCodeFile,
  type WorkspaceSubmission,
} from './workspace-source-dir'

type ApplyData = ApplyWorkspaceSourceResponse['data']
type Change = ApplyData['plan'][number]

interface ApplyOptions {
  dir: string
  verbose?: boolean
  dryRun?: boolean
  yes?: boolean
  allowDelete?: boolean
  deleteTargetOnly?: boolean
  only?: string
  to?: string
}

const SYMBOLS: Record<Change['action'], string> = {
  create: '+',
  update: '~',
  adopt: '=',
  delete: '-',
  noop: ' ',
}

/**
 * The exit status of an apply that stopped part-way: a server failure (`E_APPLY_FAILED`) is 8,
 * since applying again continues; a write refused part-way exits as a commit refused for the
 * same finding would (a resource changed or deleted since the plan 5, locked 6, too large 7,
 * else 1), since applying again would only refuse again.
 */
function failedExitCode(failed: NonNullable<ApplyData['failed']>): number {
  return failed.code === 'E_APPLY_FAILED'
    ? SOURCE_PARTIAL_EXIT_CODE
    : refusedExitCode([{ code: failed.code, severity: 'error' }])
}

/**
 * Whether `finding` is about a change the plan holds back, which refuses nothing else: one naming
 * that change. For a server that predates `refuses` only; `E_PLAN_REF_DELETED` names the workflow
 * that uses what a delete removes but sits on the delete or the plan, so no hold excuses it.
 */
function isHeldFinding(
  plan: readonly Change[],
  finding: ApplyData['diagnostics'][number]
): boolean {
  return (
    finding.code !== 'E_PLAN_REF_DELETED' &&
    plan.some((change) => change.held && change.kind === finding.kind && change.key === finding.key)
  )
}

/**
 * Whether a dry run's errors refuse the apply: the server's answer (`refuses`), or for a server
 * that predates it, any error but those of changes held back.
 */
function refusesApply(data: ApplyData): boolean {
  if (data.refuses !== undefined) return data.refuses
  return data.diagnostics.some(
    (finding) => finding.severity === 'error' && !isHeldFinding(data.plan, finding)
  )
}

/**
 * The exit status of a dry run with errors, as the apply would exit: one that holds changes back
 * and refuses nothing else writes the rest, so it exits `SOURCE_HELD_EXIT_CODE` as that apply
 * does, unless every change it would write is held (1, nothing written).
 */
function previewExitCode(data: ApplyData): number {
  if (refusesApply(data)) return refusedExitCode(data.diagnostics)
  const writesSome = data.plan.some((change) => change.action !== 'noop' && !change.held)
  return writesSome ? SOURCE_HELD_EXIT_CODE : 1
}

/** What an apply that wrote did, for the plan reprinted after it stopped part-way. */
type PlanOutcome = Pick<ApplyData, 'applied' | 'failed'>

const sameChange = (a: Pick<Change, 'kind' | 'key'>, b: Pick<Change, 'kind' | 'key'>) =>
  a.kind === b.kind && a.key === b.key

/** Whether `change`, which the plan writes, was written: not held back, and in `applied`. */
function wasWritten(change: Change, outcome: PlanOutcome): boolean {
  return outcome.applied.some((written) => sameChange(written, change))
}

/** The changes a stopped apply planned to write and did not, as `kind:key`. */
function notWritten(data: ApplyData): string[] {
  return data.plan
    .filter((change) => change.action !== 'noop' && !change.held && !wasWritten(change, data))
    .map((change) => `${change.kind}:${change.key}`)
}

/** How an apply left one planned change: held back, written, the one that failed, or not attempted. */
function changeOutcome(
  change: Change,
  outcome: PlanOutcome
): 'held back' | 'written' | 'failed, not written' | 'not written' {
  if (change.held) return 'held back'
  if (wasWritten(change, outcome)) return 'written'
  return outcome.failed && sameChange(outcome.failed, change)
    ? 'failed, not written'
    : 'not written'
}

/** {@link changeOutcome} as a plan line's suffix; a held change says so on its own. */
function outcomeText(change: Change, outcome: PlanOutcome): string {
  return change.held ? '' : ` — ${changeOutcome(change, outcome)}`
}

/**
 * The plan as a person reads it: per kind, the counts, then each change with what it touches. A
 * resource the apply leaves alone that the server changed, deleted or moved since the directory
 * was read (`diagnostics` say which) counts as that, never as unchanged, and is listed with `!`.
 * With `outcome` (an apply that stopped part-way), each change says whether it was written.
 */
function printPlan(
  plan: Change[],
  diagnostics: ApplyData['diagnostics'],
  outcome?: PlanOutcome
): void {
  const drifted = new Map<string, string>(
    serverResourceChanges(diagnostics)
      .filter((change) => change.server !== 'added')
      .map((change) => [`${change.kind}:${change.key}`, change.server])
  )
  const driftOf = (change: Change) =>
    change.action === 'noop' ? drifted.get(`${change.kind}:${change.key}`) : undefined
  const addressesOf = (code: string) =>
    new Set(
      diagnostics
        .filter((finding) => finding.code === code)
        .map((finding) => `${finding.kind}:${finding.key}`)
    )
  const stale = addressesOf('E_APPLY_STALE')
  const deleteRefused = addressesOf('E_APPLY_DELETE_NOT_ALLOWED')
  const refusedDelete = (change: Change) =>
    change.action === 'noop' && deleteRefused.has(`${change.kind}:${change.key}`)
  for (const kind of APPLY_ORDER) {
    const changes = plan.filter((change) => change.kind === kind)
    if (changes.length === 0) continue
    const counts = new Map<string, number>()
    for (const change of changes) {
      const drift = driftOf(change)
      const label = drift
        ? `${drift} on the server`
        : refusedDelete(change)
          ? 'delete refused'
          : change.action === 'noop'
            ? 'unchanged'
            : change.action
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    printError(
      `${KIND_DIRS[kind]}: ${[...counts].map(([label, count]) => `${count} ${label}`).join(', ')}`
    )
    for (const change of changes) {
      const drift = driftOf(change)
      if (drift) {
        const fate = stale.has(`${change.kind}:${change.key}`)
          ? 'your edit is refused as stale'
          : 'kept as the server has it'
        printError(`  ! ${change.key} (${drift} on the server; ${fate})`)
        continue
      }
      if (refusedDelete(change)) {
        printError(`  - ${change.key} — refused, needs --allow-delete`)
        continue
      }
      if (change.action === 'noop') continue
      const fields =
        change.fields && change.fields.length > 0 ? ` (${change.fields.join(', ')})` : ''
      const lost = Object.entries(change.destructive?.counts ?? {})
      const loses =
        lost.length > 0
          ? ` — deletes ${lost.map(([what, count]) => `${count} ${what}`).join(', ')}`
          : ''
      const held = change.held ? ' — held back (see its error)' : ''
      const status = outcome ? outcomeText(change, outcome) : ''
      printError(`  ${SYMBOLS[change.action]} ${change.key}${fields}${loses}${held}${status}`)
    }
  }
  const destructive = destructiveChanges(plan)
  if (destructive > 0) {
    printError(
      `${destructive} change(s) delete data that applying an older directory (a reverted commit) does not bring back: a deleted resource stays deleted, and its rows, documents, run history and webhook URLs are gone.`
    )
  }
}

/**
 * The binary paths an apply refusal names as not staged, when those are its only errors: the CLI
 * stages them and applies once more. `null` for any other refusal.
 */
function missingBlobPaths(error: unknown): string[] | null {
  if (!(error instanceof SimApiError) || !isRecordLike(error.details)) return null
  const { diagnostics } = error.details
  if (!Array.isArray(diagnostics)) return null
  const errors = diagnostics.filter(
    (finding): finding is { code: string; file?: string } =>
      isRecordLike(finding) && finding.severity === 'error' && typeof finding.code === 'string'
  )
  if (errors.length === 0 || errors.some((finding) => finding.code !== 'E_BLOB_MISSING')) {
    return null
  }
  return errors.flatMap((finding) => (typeof finding.file === 'string' ? [finding.file] : []))
}

/** A workflow folder's lock, as an apply answer names it. */
const WORKFLOW_LOCK_PATH = new RegExp(
  `^${KIND_DIRS.workflow}/([^/]+)/${SOURCE_LOCK_FILE.replaceAll('.', '\\.')}$`
)

/**
 * The function files of each workflow the apply wrote that its new lock no longer names, as a
 * single-workflow apply prunes them: named by the lock the folder held (so the CLI wrote them)
 * and not written now. A file the person added and no lock named is kept, and so is every file of
 * a folder whose new lock does not read as one: without it nothing tells a dropped file from a
 * kept one.
 */
async function orphanedWorkflowFiles(
  dir: string,
  files: Record<string, string>,
  recorded: Written['digests']
) {
  const filesByFolder = new Map<string, string[]>()
  for (const path of Object.keys(files)) {
    if (!path.startsWith(`${KIND_DIRS.workflow}/`)) continue
    const folder = path.split('/', 2).join('/')
    const inFolder = filesByFolder.get(folder)
    const file = path.slice(folder.length + 1)
    if (inFolder) inFolder.push(file)
    else filesByFolder.set(folder, [file])
  }
  const orphaned: string[] = []
  for (const [path, text] of Object.entries(files)) {
    const match = WORKFLOW_LOCK_PATH.exec(path)
    if (!match) continue
    const folder = `${KIND_DIRS.workflow}/${match[1]}`
    const written = filesByFolder.get(folder) ?? []
    let next: unknown = null
    try {
      next = JSON.parse(text)
    } catch {}
    if (!isRecordLike(next) || !isRecordLike(next.blocks)) continue
    const previous = await readSourceJson(dir, path)
    const inFolder = Object.fromEntries(
      Object.entries(recorded).flatMap(([recordedPath, sha]) =>
        recordedPath.startsWith(`${folder}/`) ? [[recordedPath.slice(folder.length + 1), sha]] : []
      )
    )
    orphaned.push(
      ...orphanedCodeFiles(previous, next, written, inFolder).map((file) => `${folder}/${file}`)
    )
  }
  return orphaned
}

/** Whether `path` under `dir` is gone from disk. */
async function goneFromDisk(dir: string, path: string): Promise<boolean> {
  try {
    await lstat(join(dir, path))
    return false
  } catch (error) {
    return isMissing(error)
  }
}

/**
 * The recorded paths whose resource an apply deleted: of a submitted kind, gone from disk, and no
 * longer in the base the apply returned (a blob the base no longer lists; a text file whose
 * resource it no longer records, or for a root-file kind no resource of that kind). A delete the
 * apply held or that failed leaves the resource in the base, so its record stays and a later
 * apply can still send it.
 */
async function deletedRecordedPaths(
  dir: string,
  recorded: Written['digests'],
  kinds: readonly WorkspaceKind[],
  returned: unknown
): Promise<string[]> {
  const base = parseWorkspaceBase(returned).base
  if (!base) return []
  const addresses = new Set(Object.keys(base.resources))
  const kindsHeld = new Set(
    [...addresses].flatMap((address) => parseResourceAddress(address)?.kind ?? [])
  )
  const blobs = baseBlobDigests(returned, kinds)
  const candidates = Object.keys(recorded).filter((path) => {
    const kind = kindOfPath(path)
    if (kind === null || !kinds.includes(kind)) return false
    if (isBlobPath(path)) return !blobs.has(path)
    if (isFileKind(kind)) return !kindsHeld.has(kind)
    const [key] = KIND_LAYOUTS[kind].group([path]).groups.keys()
    return key !== undefined && !addresses.has(`${kind}:${key}`)
  })
  const gone = await Promise.all(candidates.map((path) => goneFromDisk(dir, path)))
  return candidates.filter((_, index) => gone[index])
}

/**
 * The text files the directory sent for a resource the apply reprinted that the reprint no longer
 * holds, such as a tool whose code the server keeps as `stored()` (a credential in it), reprinted
 * without `tools/<key>.js` ({@link saveApplied} keeps that one on disk). Workflow folders keep
 * files no lock named, so their function files are pruned by lock instead
 * ({@link orphanedWorkflowFiles}); blobs are never reprinted.
 */
function droppedResourceFiles(
  sent: Readonly<Record<string, string>>,
  reprinted: Readonly<Record<string, string>>
): string[] {
  const byResource = (paths: readonly string[]) => {
    const resources = new Map<string, string[]>()
    for (const path of paths) {
      const kind = kindOfPath(path)
      if (kind === null || kind === 'workflow' || isBlobPath(path)) continue
      for (const [key, files] of KIND_LAYOUTS[kind].group([path]).groups) {
        const address = `${kind}:${key}`
        resources.set(address, [...(resources.get(address) ?? []), ...files])
      }
    }
    return resources
  }
  const sentByResource = byResource(Object.keys(sent))
  return [...byResource(Object.keys(reprinted)).keys()].flatMap((address) =>
    (sentByResource.get(address) ?? []).filter((path) => !Object.hasOwn(reprinted, path))
  )
}

/**
 * Saves what an apply stored back into the directory: the reprinted files, the next base, and
 * their digests in `.sim/written.json` (`written` is what it held), beside the digests of the
 * blobs the server now holds. The function files a written workflow no longer uses, and the files
 * a reprinted resource no longer has, are removed from disk and the record; the record also drops
 * the files of resources the apply deleted ({@link deletedRecordedPaths}). A tool's code file the
 * reprint no longer names is the person's only copy of that code, so like a workflow's function
 * file it stays on disk, leaves the record, and is named in a warning; no apply sends it again.
 * `records` are the stored-edges records of the workflows it reprinted.
 */
async function saveApplied(
  dir: string,
  data: ApplyData,
  submission: WorkspaceSubmission,
  written: Written,
  records: ReadonlyArray<readonly [string, string]>
): Promise<void> {
  assertWorkspacePaths(Object.keys(data.files))
  const toolCode: Array<{ path: string; declaration: string }> = []
  const orphaned = await orphanedWorkflowFiles(dir, data.files, written.digests)
  for (const path of droppedResourceFiles(submission.files, data.files)) {
    const tool = toolOfCodeFile(path)
    if (tool) toolCode.push({ path, declaration: tool.declaration })
    else orphaned.push(path)
  }
  const kept = { ...written.digests, ...appliedBlobDigests(submission, data.base) }
  const deleted = await deletedRecordedPaths(dir, written.digests, submission.kinds, data.base)
  for (const path of [...orphaned, ...deleted, ...toolCode.map(({ path }) => path)]) {
    delete kept[path]
  }
  const record = writtenRecord(
    data.files,
    kept,
    new Map([...recordedStats(written), ...submission.hashed])
  )
  await updateSourceDir(dir, {
    write: [
      ...Object.entries(data.files),
      [WORKSPACE_BASE_FILE, `${JSON.stringify(data.base, null, 2)}\n`],
      ...writtenFiles(record),
      ...records,
    ],
    remove: [...orphaned, ...removedWorkflowRecords(deleted)],
  })
  for (const { path, declaration } of toolCode) {
    printError(
      `warning: ${path} is no longer named by ${declaration} (its code is now kept as stored() or printed inline), so it was left on disk as written and no apply sends it: delete it, or name it again with codeFile(). Never commit one that holds a credential.`
    )
  }
}

/** The workflow a directory's base belongs to (a workflow source directory), or `null`. */
function baseWorkflowOf(base: unknown): string | null {
  return isRecordLike(base) && typeof base.workflowId === 'string' ? base.workflowId : null
}

/** The workspace a directory's base was read from, or `null` when it has none. */
function baseWorkspaceOf(base: unknown): string | null {
  return isRecordLike(base) && typeof base.workspaceId === 'string' ? base.workspaceId : null
}

/** A promotion's submission, with what it needs to record the target once applied. */
interface Promotion {
  submission: WorkspaceSubmission
  /** The directory's own text files, before the target's records replaced its workflows'. */
  files: Record<string, string>
  /** The record the last promotion to this target left, if any. */
  record: PromotionRecord | undefined
  /** The target workspace. */
  target: string
  /** What the target deleted since the last promotion that the directory declares (addresses). */
  deletedInTarget: string[]
  /** What only the target holds: undeclared, and no promotion from the directory left it there. */
  targetOnly: string[]
}

/**
 * The submission that promotes `submission` (read for the target, so every workflow folder is
 * whole) to `target`: the target's get supplies its base and each workflow's lock and base, so
 * its resources are bound by key and updated in place, and the target's promotion record (what
 * the last promotion from this directory left there) is the base each resource it holds compares
 * with. Refuses a target the directory was read from, which a plain apply serves.
 */
async function promoted(
  client: OperationClient<'getWorkspaceSource'>,
  dir: string,
  submission: WorkspaceSubmission,
  target: string,
  deleteTargetOnly: boolean
): Promise<Promotion> {
  if (baseWorkspaceOf(submission.base) === target) {
    throw new SourceDirError(`${dir} was read from workspace ${target}; apply it without --to.`, {
      code: 'SOURCE_PROMOTE_SAME_WORKSPACE',
    })
  }
  const recordPath = promotionRecordPath(target)
  const record = recordPath
    ? parsePromotionRecord(await readSourceJson(dir, recordPath), target)
    : undefined
  const { data } = await client.request<GetWorkspaceSourceResponse>('getWorkspaceSource', {
    params: { workspaceId: target },
    query: { kinds: submission.kinds.join(',') },
  })
  const targetBase = parseWorkspaceBase(data.base).base
  if (!targetBase) {
    throw new SourceDirError(`Workspace ${target} answered with a base this CLI cannot read.`)
  }
  const composed = promotionSubmission({
    files: submission.files,
    blobPaths: submission.blobs.map((blob) => blob.path),
    kinds: submission.kinds,
    target: { files: data.files, base: targetBase },
    record,
    deleteTargetOnly,
  })
  return {
    submission: { ...submission, files: composed.files, base: composed.base },
    files: submission.files,
    record,
    target,
    deletedInTarget: composed.deletedInTarget,
    targetOnly: composed.targetOnly,
  }
}

/**
 * Saves what a promotion applied to `target` as its promotion record in the directory, the base
 * the next promotion there compares with. Nothing else in the directory changes.
 */
async function savePromotion(
  dir: string,
  target: string,
  promotion: Promotion,
  data: ApplyData
): Promise<void> {
  const path = promotionRecordPath(target)
  const base = parseWorkspaceBase(data.base).base
  if (!path || !base) return
  const record = promotionRecord({
    workspaceId: target,
    previous: promotion.record,
    kinds: promotion.submission.kinds,
    files: promotion.files,
    submission: {
      files: promotion.submission.files,
      base: parseWorkspaceBase(promotion.submission.base).base ?? base,
      targetOnly: promotion.targetOnly,
    },
    applied: { base, files: data.files, plan: data.plan },
  })
  await updateSourceDir(dir, { write: [[path, `${JSON.stringify(record, null, 2)}\n`]] })
}

type Finding = ApplyData['diagnostics'][number]

/** `tables/leads`, or `secrets.ts KEY` for a root file's entry: how a promotion finding names one. */
function resourceWhere(kind: WorkspaceKind, key: string): string {
  return isFileKind(kind) ? `${KIND_DIRS[kind]} ${key}` : `${KIND_DIRS[kind]}/${key}`
}

/**
 * The hint a promotion to `target` gives a refusal the server words for an apply to the
 * directory's own workspace ("get it into a fresh directory"), which a promotion cannot follow.
 */
function promotionHint(code: string, target: string, targetOnly: boolean): string | undefined {
  const record = promotionRecordPath(target) ?? '.sim/targets/<workspaceId>.json'
  if (code === 'E_APPLY_STALE') {
    return `Workspace ${target} changed this resource since the last promotion from this directory. Carry that change into the directory (\`sim workspaces source get --workspace ${target} --dir <fresh dir>\` prints it), or undo it in ${target}, then promote again. Don't delete ${record} to get past this: the next promotion would then overwrite every change made in ${target} since, rows its workflows wrote included.`
  }
  if (code === 'W_SERVER_CHANGED') {
    return `Workspace ${target} changed this resource since the last promotion from this directory, and this promotion keeps that change. To carry it into the directory, \`sim workspaces source get --workspace ${target} --dir <fresh dir>\` prints it.`
  }
  if (code === 'E_APPLY_DELETE_NOT_ALLOWED') {
    return `This directory no longer declares it. Pass --allow-delete to delete it in ${target} too: that deletes only what this directory dropped, and resources only ${target} holds are kept. Or restore it to keep it.`
  }
  if (code === 'W_UNDECLARED' && targetOnly) {
    return `Only workspace ${target} holds it: this directory does not declare it and no promotion from it left it there, so the promotion keeps it, with or without --allow-delete. To delete it there, add --delete-target-only beside --allow-delete; to manage it from this directory, declare it here.`
  }
  if (code === 'E_APPLY_NO_BASE') {
    return `Workspace ${target} holds this resource, but no promotion from this directory recorded it. Rename the declaration, or rename or delete the resource in ${target}, then promote again.`
  }
  return undefined
}

/** `finding` with the hint `promotion` gives its code, when it gives one. */
function withPromotionHint<F extends { hint?: string; kind?: unknown; key?: unknown }>(
  finding: F,
  code: string,
  promotion: Promotion
): F {
  const targetOnly = promotion.targetOnly.includes(`${finding.kind}:${finding.key}`)
  const hint = promotionHint(code, promotion.target, targetOnly)
  return hint === undefined ? finding : { ...finding, hint }
}

/**
 * The server's findings as a promotion reports them: refusals carry the promotion's hint, and the
 * server's `W_SERVER_DELETED` for a resource the promotion warns about itself
 * (`W_PROMOTE_TARGET_DELETED`) is left out.
 */
function promotionDiagnostics(diagnostics: readonly Finding[], promotion: Promotion): Finding[] {
  const warned = new Set(promotion.deletedInTarget)
  return diagnostics.flatMap((finding) =>
    finding.code === 'W_SERVER_DELETED' && warned.has(`${finding.kind}:${finding.key}`)
      ? []
      : [withPromotionHint(finding, finding.code, promotion)]
  )
}

/**
 * The warnings only a promotion knows to give: each declared resource the target deleted since the
 * last promotion (kept deleted), and each resource only the target holds that
 * `--delete-target-only` deletes there (of an apply that stopped part-way, each it deleted). One
 * it keeps is the server's `W_UNDECLARED`, with the promotion's hint.
 */
function promotionWarnings(
  promotion: Promotion,
  outcome: Pick<ApplyData, 'plan' | 'applied' | 'failed'>
): Finding[] {
  const { target } = promotion
  const deleted = promotion.deletedInTarget.flatMap((address): Finding[] => {
    const parsed = parseResourceAddress(address)
    if (!parsed) return []
    return [
      {
        code: 'W_PROMOTE_TARGET_DELETED',
        severity: 'warning',
        message: `${resourceWhere(parsed.kind, parsed.key)} was deleted in workspace ${target} since the last promotion; this promotion keeps it deleted there.`,
        hint: `To create it in ${target} again, remove its entry from ${promotionRecordPath(target) ?? 'the promotion record'}, then promote again.`,
        kind: parsed.kind,
        key: parsed.key,
      },
    ]
  })
  const onlyInTarget = new Set(promotion.targetOnly)
  const targetOnly = outcome.plan
    .filter(
      (change) =>
        change.action === 'delete' &&
        onlyInTarget.has(`${change.kind}:${change.key}`) &&
        (!outcome.failed || wasWritten(change, outcome))
    )
    .map(
      (change): Finding => ({
        code: 'W_PROMOTE_DELETES_TARGET_ONLY',
        severity: 'warning',
        message: `${resourceWhere(change.kind, change.key)} is only in workspace ${target}, not in this directory, so --delete-target-only deletes it there.`,
        hint: 'Promote without --delete-target-only to keep it, or declare it in this directory.',
        kind: change.kind,
        key: change.key,
      })
    )
  return [...deleted, ...targetOnly]
}

/**
 * `refusal` with its findings as a promotion reports them (see {@link promotionDiagnostics}): a
 * new error, the caller's left as it was.
 */
function rehinted(refusal: unknown, promotion: Promotion): unknown {
  if (!(refusal instanceof SimApiError) || !isRecordLike(refusal.details)) return refusal
  const { diagnostics } = refusal.details
  if (!Array.isArray(diagnostics)) return refusal
  const details = {
    ...refusal.details,
    diagnostics: diagnostics.map((finding) =>
      isRecordLike(finding) && typeof finding.code === 'string'
        ? withPromotionHint(finding, finding.code, promotion)
        : finding
    ),
  }
  const copy = new SimApiError(
    refusal.message,
    refusal.status,
    refusal.code,
    details,
    refusal.exitCode,
    refusal.requestId
  )
  copy.retryAfterMs = refusal.retryAfterMs
  return copy
}

/**
 * `sim workspaces source apply --dir <dir>`: applies a directory `workspaces source get` wrote.
 * On a terminal it shows the plan and asks; anywhere else it needs `--yes`. Binary files are
 * staged first, by hash (only those the server does not hold staged for this caller, so an
 * interrupted upload resumes), then one apply names them: the server plans once and writes
 * nothing when a blob it needs is missing.
 */
export function attachWorkspaceSourceApply(source: Command): void {
  const [command, connect] = apiCommand(source, 'apply', [
    'applyWorkspaceSource',
    'findMissingWorkspaceSourceBlobs',
    'stageWorkspaceSourceBlobs',
    'getWorkspaceSource',
    'getSourceCatalog',
    'getWorkflowDeployment',
  ])
  absoluteDirOption(command)
  verboseFlag(command)
  searchTasks(command, [
    'promote dev to prod',
    'copy every workflow from a dev workspace into a prod workspace (--to)',
    'save bulk edits to every workflow',
  ])
  command
    .option('--dir <dir>', 'Workspace source directory written by `workspaces source get`', '.')
    .option('--dry-run', 'Plan and check without writing anything')
    .option('-y, --yes', 'Apply without asking for confirmation')
    .option(
      '--allow-delete',
      "Delete resources, columns and data the directory no longer declares (with --to, only what it deleted since the last promotion: the target's own resources are kept)"
    )
    .option(
      '--delete-target-only',
      "With --to and --allow-delete, also delete the target's resources this directory never declared and no promotion from it left there (prod-only tables and their rows, skills made in prod). Without it a promotion keeps them, naming each with a warning"
    )
    .option('--only <kinds>', `Apply only these kinds (${ONLY_KINDS_HELP})`)
    .option(
      '--to <workspaceId>',
      "Promote the directory to another workspace (dev to prod): its resources bind by key to that workspace's own and are updated in place. Only .sim/targets/<workspaceId>.json changes, the record the next promotion compares with: a resource changed there since is kept, or refused as stale (exit 5) when the directory changed it too"
    )
    .allowExcessArguments(false)
    .description('Apply a workspace source directory')
    .addHelpText(
      'after',
      `${sourceExitCodesHelp('workspaces source apply')}${SOURCE_WRITE_EXIT_CODES_HELP}`
    )
    .action(async (options: ApplyOptions) => {
      assertTargetOnlyDeletable(options)
      const mode = writeMode(options)
      const only = parseKinds(options.only)
      const { client, profile } = connect()
      const readFrom = baseWorkspaceOf(await readSourceJson(options.dir, WORKSPACE_BASE_FILE))
      const workspaceId =
        options.to ??
        client.requireWorkspace(
          directoryWorkspace(
            options.dir,
            readFrom,
            profile,
            (from, named) =>
              `Run it without --workspace to apply it to ${from}, or promote it with --to ${named}: its resources bind by key to that workspace's own, and the directory stays bound to ${from}.`
          ) ?? undefined
        )
      const provenance = await gitProvenance(options.dir)
      const post = async (submission: WorkspaceSubmission, dryRun: boolean) => {
        const body: ApplyWorkspaceSourceBody = {
          files: submission.files,
          kinds: submission.kinds,
          blobs: submission.blobs,
          ...(submission.base ? { base: submission.base } : {}),
          options: {
            ...(options.allowDelete ? { allowDelete: true } : {}),
            ...(only ? { only } : {}),
          },
          provenance: { client: 'cli', ...provenance },
        }
        const response = await client.request<ApplyWorkspaceSourceResponse>(
          'applyWorkspaceSource',
          {
            params: { workspaceId },
            ...(dryRun ? { query: { dryRun: true } } : {}),
            body,
            retryRateLimited: true,
          }
        )
        return response.data
      }
      /** Uploads what the server lacks of `paths`; nothing is applied if this fails. */
      const stage = async (submission: WorkspaceSubmission, paths: ReadonlySet<string>) => {
        let staged: { count: number; bytes: number }
        try {
          staged = await stageBlobs(client, workspaceId, options.dir, submission.blobs, paths)
        } catch (error) {
          return printRefusal(error, profile.output, { verbose: options.verbose === true })
        }
        if (staged.count > 0) {
          printError(`Uploaded ${staged.count} binary file(s), ${staged.bytes} bytes.`)
        }
      }
      /**
       * Sends the directory. A commit the server refuses only for blobs that are not staged (the
       * CLI's guess from the base missed one) stages those and is sent once more.
       */
      let promotion: Promotion | null = null
      const send = async (submission: WorkspaceSubmission, dryRun: boolean): Promise<ApplyData> => {
        let refusal: unknown
        try {
          return await post(submission, dryRun)
        } catch (error) {
          refusal = error
        }
        const missing = dryRun ? null : missingBlobPaths(refusal)
        if (missing && missing.length > 0) {
          await stage(submission, new Set(missing))
          try {
            return await post(submission, dryRun)
          } catch (error) {
            refusal = error
          }
        }
        return printRefusal(promotion ? rehinted(refusal, promotion) : refusal, profile.output, {
          ...(dryRun ? {} : { ifAnswerLost: answerLostHint(options.dir) }),
          verbose: options.verbose === true,
        })
      }

      await withSourceDirLock(
        options.dir,
        async () => {
          const written = await readWritten(options.dir)
          const read = await readWorkspaceDir(options.dir, only, workspaceId, written)
          // The read already walked the kind folders: only a read that found none, or a workflow
          // directory's base, needs the full check (which refuses with the reason).
          if (read.kinds.length === 0 || baseWorkflowOf(read.base) !== null) {
            await assertWorkspaceDir(options.dir)
          }
          assertBlobsFetched(options.dir, read, written.digests)
          promotion = options.to
            ? await promoted(
                client,
                options.dir,
                read,
                options.to,
                options.deleteTargetOnly === true
              )
            : null
          const submission = promotion?.submission ?? read
          /** `data` as this apply reports it: a promotion's own wording and warnings added. */
          const reported = (data: ApplyData): ApplyData =>
            promotion
              ? {
                  ...data,
                  diagnostics: [
                    ...promotionWarnings(promotion, data),
                    ...promotionDiagnostics(data.diagnostics, promotion),
                  ],
                }
              : data
          // The apply repeats findings the preview already showed: each is printed once.
          const findings = findingsOutput(profile.output, options.verbose, options.dir)
          const notSent = notSentFindings(submission.ignored)
          findings.print(notSent)
          /** Prints `data` as the result, with the findings about files the CLI did not send. */
          const report = (data: ApplyData, next?: NextStep, urls: WorkflowUrl[] = []) => {
            const diagnostics = [...notSent, ...data.diagnostics]
            appendStepSummary(() =>
              planMarkdown({ ...data, diagnostics }, options.to ?? workspaceId)
            )
            const result = {
              ...summarize({ ...data, diagnostics }),
              ...(urls.length > 0 ? { urls } : {}),
              ...(next ? { next } : {}),
            }
            printProtocolResult(
              profile.output,
              { ...result, ...findings.result(diagnostics) },
              {
                created: createdText(result.created),
                ...(urls.length > 0 ? { urls: workflowUrlsText(urls) } : {}),
                ...(next ? { next: next.command } : {}),
              }
            )
          }
          const data = await runSourceWrite<ApplyData>({
            mode,
            preview: async () => reported(await send(submission, true)),
            show: (preview) => {
              printPlan(preview.plan, preview.diagnostics)
              findings.print(preview.diagnostics)
            },
            refuses: refusesApply,
            previewExitCode,
            // Without a preview, stage the blobs the base does not hold as they are.
            beforeCommit: (preview) =>
              stage(submission, preview ? new Set(preview.needBlobs) : blobsToStage(submission)),
            commit: async () => {
              const answer = reported(await send(submission, false))
              findings.print(answer.diagnostics)
              return answer
            },
            save: async (answer) => {
              // A promotion leaves the directory bound to the workspace it was read from, and
              // records what it left in the target for the next promotion to compare with.
              if (promotion) {
                await savePromotion(options.dir, promotion.target, promotion, answer)
                return
              }
              const workspaceCatalog = cachedCatalog(workspaceId)
              const { records, unrecorded } = workspaceCatalog
                ? await workflowFolderRecords(client, workspaceId, workspaceCatalog, answer.files)
                : { records: [], unrecorded: [] }
              await saveApplied(options.dir, answer, submission, written, records)
              const unrecordedWarning = unrecordedFoldersWarning(unrecorded)
              if (unrecordedWarning) printError(unrecordedWarning)
            },
            report,
            question: `Apply these changes to workspace ${workspaceId}?`,
            command: applyCommand(options),
            interrupt: {
              verb: 'apply',
              dir: options.dir,
              noun: 'workspace',
              ifAnswerLost: answerLostHint(options.dir),
            },
          })
          if (!data) return
          if (data.failed) {
            printError('The apply stopped part-way; each planned change:')
            printPlan(data.plan, data.diagnostics, data)
          } else if (mode === 'write') printPlan(data.plan, data.diagnostics)
          const held = data.plan.filter((change) => change.held)
          if (held.length > 0) {
            printError(
              `Held back, not written: ${held.map((change) => `${change.kind} ${change.key}`).join(', ')}. Fix what each one's error names, then apply again.`
            )
            // Written in part is not the same outcome as nothing written: a script must tell them apart.
            setSoftExitCode(data.applied.length > 0 ? SOURCE_HELD_EXIT_CODE : 1)
          }
          if (data.failed) {
            printError(`Stopped at ${data.failed.kind} ${data.failed.key}: ${data.failed.message}`)
            setSoftExitCode(failedExitCode(data.failed))
          }
          report(
            data,
            undefined,
            await deploymentUrls(
              client,
              data,
              promotion ? undefined : (path) => readSourceText(options.dir, path)
            )
          )
        },
        { readOnly: mode === 'dry-run' || mode === 'plan' }
      )
    })
}

/** At most this many changes and errors are listed in a step summary; the rest are counted. */
const SUMMARY_ROWS = 50

/** A Markdown table cell: one line, with its pipes escaped. */
function cell(text: string): string {
  return safeOneLine(text).replaceAll('|', '\\|')
}

/**
 * The plan of a dry run or apply to `workspaceId` as the Markdown a GitHub Actions step summary
 * shows: each change and how it went, then each error.
 */
function planMarkdown(data: ApplyData, workspaceId: string): string {
  const summary = summarize(data)
  const [created, updated, deleted] = data.dryRun
    ? ['to create', 'to update', 'to delete']
    : ['created', 'updated', 'deleted']
  const changes = data.plan.filter((change) => change.action !== 'noop')
  const rows = changes.slice(0, SUMMARY_ROWS).map((change) => {
    const fields = change.fields?.length ? ` (${cell(change.fields.join(', '))})` : ''
    const fate = data.dryRun && !change.held ? 'planned' : changeOutcome(change, data)
    return `| ${SYMBOLS[change.action]} | ${cell(resourceWhere(change.kind, change.key))}${fields} | ${change.action} | ${fate} |`
  })
  const errors = data.diagnostics.filter((finding) => finding.severity === 'error')
  const lines = [
    `### Sim workspace ${data.dryRun ? 'plan' : 'apply'}: ${cell(workspaceId)}`,
    '',
    `${summary.created.length} ${created}, ${summary.updated} ${updated}, ${summary.deleted} ${deleted}, ${summary.unchanged} unchanged; ${summary.errors} error(s), ${summary.warnings} warning(s).`,
    ...(rows.length > 0
      ? [
          '',
          '| | Resource | Change | Outcome |',
          '|---|---|---|---|',
          ...rows,
          ...(changes.length > rows.length ? [`\n…and ${changes.length - rows.length} more.`] : []),
        ]
      : []),
    ...(errors.length > 0
      ? [
          '',
          '**Errors**',
          '',
          ...errors
            .slice(0, SUMMARY_ROWS)
            .map(
              (finding) =>
                `- \`${finding.code}\`${finding.file ? ` ${cell(finding.file)}${finding.line ? `:${finding.line}` : ''}` : ''}: ${cell(finding.message)}`
            ),
        ]
      : []),
  ]
  return lines.join('\n')
}

/** A webhook URL of a workflow an apply deployed, named by the workflow's key and the block's. */
interface WorkflowUrl extends DeployedUrl {
  workflow: string
}

/** The URLs as one display line: `lead-intake: leadin (hook) https://…; …`. */
function workflowUrlsText(urls: readonly WorkflowUrl[]): string {
  const byWorkflow = new Map<string, DeployedUrl[]>()
  for (const { workflow, ...url } of urls) {
    byWorkflow.set(workflow, [...(byWorkflow.get(workflow) ?? []), url])
  }
  return [...byWorkflow]
    .map(([workflow, each]) => `${workflow}: ${deployedUrlsText(each)}`)
    .join('; ')
}

/**
 * The webhook URLs of each workflow a written apply deployed (a `deployments/<key>.ts` it created
 * or updated), in the workspace it wrote: a promotion's are the target's, which are new URLs.
 * Each block is named as the workflow's reprinted lock names it, or, when the apply did not
 * reprint the workflow (it wrote only the deployment), as `savedLock` reads it from the directory
 * (none for a promotion, whose directory holds the source workspace's block ids).
 */
async function deploymentUrls(
  client: OperationClient<'getWorkflowDeployment'>,
  data: ApplyData,
  savedLock?: (path: string) => Promise<string | null>
): Promise<WorkflowUrl[]> {
  if (data.dryRun) return []
  const base = parseWorkspaceBase(data.base).base
  const deployed = data.applied.filter(
    (change) => change.kind === 'deployment' && change.action !== 'delete'
  )
  const perWorkflow = await Promise.all(
    deployed.map(async ({ key }): Promise<WorkflowUrl[]> => {
      const workflowId = base?.resources[resourceAddress('workflow', key)]?.id
      if (!workflowId) return []
      const lockPath = `${workflowFolder(key)}/${SOURCE_LOCK_FILE}`
      const lock = data.files[lockPath] ?? (await savedLock?.(lockPath)) ?? null
      const named = await deployedUrls(client, workflowId, lockBlockNames(lock))
      return named.map((url) => ({ workflow: key, ...url }))
    })
  )
  return perWorkflow.flat()
}

/** This apply as a command, without `--yes` or `--dry-run`: what a plan run names next. */
function applyCommand(options: ApplyOptions): string {
  return [
    `sim workspaces source apply --dir ${shellWord(options.dir)}`,
    ...(options.only ? [`--only ${shellWord(options.only)}`] : []),
    ...(options.to ? [`--to ${shellWord(options.to)}`] : []),
    ...(options.allowDelete ? ['--allow-delete'] : []),
    ...(options.deleteTargetOnly ? ['--delete-target-only'] : []),
  ].join(' ')
}

/**
 * Refuses `--delete-target-only` without `--to` (only a promotion has a target of its own) or
 * without `--allow-delete` (the server deletes nothing without it): the flag never stands in for
 * consent to the directory's own deletes.
 */
function assertTargetOnlyDeletable(options: ApplyOptions): void {
  if (!options.deleteTargetOnly) return
  if (!options.to) {
    throw new CliUsageError(
      "--delete-target-only deletes a promotion target's own resources: it needs --to <workspaceId>."
    )
  }
  if (!options.allowDelete) {
    throw new CliUsageError(
      '--delete-target-only needs --allow-delete beside it: add it, and the promotion also deletes what this directory deleted since the last promotion.'
    )
  }
}

/**
 * A `W_PATH_NOT_SENT` warning for each file under a kind folder the CLI does not send: a hidden
 * name, or a character no workspace path holds.
 */
function notSentFindings(paths: readonly string[]): ApplyData['diagnostics'] {
  return paths.map((path) => ({
    code: 'W_PATH_NOT_SENT' as const,
    severity: 'warning' as const,
    message: `${path} is not sent: a hidden name, or a character no workspace path holds. The apply writes and deletes nothing for it.`,
    hint: 'Rename it to send it, or move it out of the kind folder.',
    file: path,
  }))
}

/**
 * The next step for an apply write whose answer never came back (a timeout, a dropped connection,
 * an interrupt): it may or may not have been written.
 */
function answerLostHint(dir: string): string {
  return `It may have been written. Run \`sim workspaces source apply --dir ${dir} --dry-run\`: no changes, or only the workflows you edited refused as stale (exit 5), means it may have been, or someone else changed those resources. Run \`sim workspaces source get --dir <fresh dir>\` and compare it with ${dir}: if it holds your edits, \`sim workspaces source get --dir ${dir} --force\` brings this directory up to date; if not, reapply your edits in the fresh directory. Any other outcome means it was not written: apply again.`
}

/**
 * The result line: what a dry run would write, or what an apply wrote (not what it planned).
 * `created` lists each resource created, with its id once written.
 */
function summarize(data: ApplyData) {
  const changes = data.dryRun ? data.plan : data.applied
  const count = (action: Change['action']) =>
    changes.filter((change) => change.action === action).length
  return {
    workspaceId: data.workspaceId,
    dryRun: data.dryRun,
    applied: data.applied.length,
    created: changes
      .filter((change) => change.action === 'create' && !change.held)
      .map(({ kind, key, id }) => ({ kind, key, ...(id !== undefined ? { id } : {}) })),
    updated: count('update') + count('adopt'),
    deleted: count('delete'),
    destructive: destructiveChanges(changes),
    unchanged: data.plan.filter((change) => change.action === 'noop').length,
    held: data.plan.filter((change) => change.held).length,
    ...(data.failed
      ? { failed: `${data.failed.kind}:${data.failed.key}`, notWritten: notWritten(data) }
      : {}),
    ...(data.applyId ? { applyId: data.applyId } : {}),
    errors: data.diagnostics.filter((finding) => finding.severity === 'error').length,
    warnings: data.diagnostics.filter((finding) => finding.severity === 'warning').length,
  }
}
