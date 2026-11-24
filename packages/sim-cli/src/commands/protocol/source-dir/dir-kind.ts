/**
 * What a source directory is: one workflow's, a whole workspace's, or a workflow folder of a
 * workspace directory, and which workspace a command on it acts on.
 */

import { basename, dirname, resolve } from 'node:path'
import { toRecord } from '@sim/utils/object'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import type { Command } from 'commander'
import type { ResolvedProfile } from '../../../config/index'
import { embedStore } from '../../../embed-context'
import { SourceDirError } from '../local-errors'
import { readSourceJson, readSourceText } from './files'
import { SOURCE_STARTER_FILE } from './layout'

/**
 * Makes `command`'s `--dir` (given or defaulted) an absolute path before its action runs, so every
 * message names the directory it read wherever the CLI ran: a wrapper that changes directory
 * first made `.` name a folder its caller never meant. An embedded run keeps its host's path.
 */
export function absoluteDirOption(command: Command): Command {
  return command.hook('preAction', (_hooked, action) => {
    const dir: unknown = action.getOptionValue('dir')
    if (typeof dir === 'string' && !embedStore.getStore()) {
      action.setOptionValue('dir', resolve(dir))
    }
  })
}

/**
 * The workspace a source command acts on for a directory read from `readFrom`: that workspace,
 * whatever the profile's default, so a directory stays bound to where it came from. Only a
 * `--workspace` naming another one is refused, with `next` saying what to run instead (given the
 * workspace the directory was read from and the one named). A directory that records no workspace
 * takes the profile's (`null` when none is selected).
 */
export function directoryWorkspace(
  dir: string,
  readFrom: string | null,
  profile: Pick<ResolvedProfile, 'workspaceId' | 'sources'>,
  next: (readFrom: string, named: string) => string
): string | null {
  const named = profile.workspaceId
  if (readFrom === null) return named
  if (profile.sources.workspaceId !== 'flag' || named === null || named === readFrom) {
    return readFrom
  }
  throw new SourceDirError(
    `${dir} was read from workspace ${readFrom}, but --workspace names ${named}. ${next(readFrom, named)}`,
    { code: 'SOURCE_OTHER_WORKSPACE' }
  )
}

/** Which source command family a directory belongs to: one workflow's, or a whole workspace's. */
export type SourceDirKind = 'workflow' | 'workspace'

/**
 * What `dir` holds, by its `.sim/base.json` (read leniently, as an apply reads it: a base the
 * parser refuses still names what it is): a workflow base names its `workflowId`, a workspace base
 * only its `workspaceId`. Without a base, a `workflow.ts` or a starter record at the root is a
 * workflow directory (a workspace directory keeps its workflows under `workflows/<key>/`). `null`
 * for a directory that holds neither, such as a new one.
 */
async function sourceDirKind(
  dir: string
): Promise<{ kind: SourceDirKind; readFrom: string | null } | null> {
  const base = toRecord(await readSourceJson(dir, SOURCE_BASE_FILE))
  if (typeof base.workflowId === 'string') return { kind: 'workflow', readFrom: base.workflowId }
  if (typeof base.workspaceId === 'string') {
    return { kind: 'workspace', readFrom: base.workspaceId }
  }
  const starter = await readStarterWorkspace(dir)
  if (starter !== null || (await readSourceText(dir, SOURCE_ENTRY_FILE)) !== null) {
    return { kind: 'workflow', readFrom: null }
  }
  return null
}

/**
 * Refuses a `kind` command on a directory of the other kind, whatever `--force` says: a workflow
 * get into a workspace directory (or the reverse) would replace its base, so staleness could no
 * longer be detected and its unapplied edits would sit in a directory neither command reads.
 */
export async function assertSourceDirKind(dir: string, kind: SourceDirKind): Promise<void> {
  const held = await sourceDirKind(dir)
  if (held === null || held.kind === kind) return
  const message =
    held.kind === 'workspace'
      ? `${dir} is a workspace source directory${held.readFrom ? ` (workspace ${held.readFrom})` : ''}, so a \`sim workflows source\` command would replace its base. Edit a workflow of it in ${dir}/${KIND_DIRS.workflow}/<key> with \`sim workspaces source\` (check, status, apply) --dir ${dir}, or get the workflow into another directory.`
      : `${dir} is a workflow source directory${held.readFrom ? ` (workflow ${held.readFrom})` : ''}, so a \`sim workspaces source\` command would replace its base. Use \`sim workflows source\` (get, check, status, apply) --dir ${dir}, or get the workspace into another directory.`
  throw new SourceDirError(message, { code: 'SOURCE_DIR_KIND_MISMATCH' })
}

/** The workspace {@link SOURCE_STARTER_FILE} names, or `null` when the directory holds no starter. */
export async function readStarterWorkspace(dir: string): Promise<string | null> {
  const workspaceId = toRecord(await readSourceJson(dir, SOURCE_STARTER_FILE)).workspaceId
  return typeof workspaceId === 'string' ? workspaceId : null
}

/**
 * A `workflows/<key>` folder of a workspace directory: `root` holds a workspace `.sim/base.json`.
 * The workspace's `.sim/written.json` and base are the folder's records too, so a single-workflow
 * write keeps them instead of writing a record of its own the workspace commands never read.
 */
export interface WorkspaceFolder {
  root: string
  workspaceId: string
  /** The folder's key under `workflows/`. */
  key: string
}

/** The workspace directory `dir` is a workflow folder of, or `null`. */
export async function workspaceFolderOf(dir: string): Promise<WorkspaceFolder | null> {
  const folder = resolve(dir)
  if (basename(dirname(folder)) !== KIND_DIRS.workflow) return null
  const root = dirname(dirname(folder))
  const base = toRecord(await readSourceJson(root, SOURCE_BASE_FILE))
  if (typeof base.workspaceId !== 'string' || base.workflowId !== undefined) return null
  return { root, workspaceId: base.workspaceId, key: basename(folder) }
}
