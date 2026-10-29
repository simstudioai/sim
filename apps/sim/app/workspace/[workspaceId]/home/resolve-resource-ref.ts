import type { QueryClient } from '@tanstack/react-query'
import { V2_SEARCH_MAX_LENGTH } from '@/lib/api/contracts/v2/shared'
import type { MothershipResource, WorkspaceResourceRef } from '@/lib/mothership/resources/types'
import { canonicalWorkspaceFilePath } from '@/lib/mothership/vfs/path-utils'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { findWorkspaceFileByPath } from '@/hooks/queries/utils/find-workspace-file-by-src'
import {
  distinctFiles,
  getWorkspaceFileLookupQueryOptions,
  getWorkspaceFileSearchQueryOptions,
} from '@/hooks/queries/workspace-files'

/**
 * The one file whose name is exactly {@link name}, or undefined. Two files can
 * share a name in different folders, and opening the wrong one is worse than
 * opening none, so an ambiguous name does not resolve.
 */
function findFileByUniqueName(
  files: readonly WorkspaceFileRecord[],
  name: string
): WorkspaceFileRecord | undefined {
  if (!name) return undefined
  let match: WorkspaceFileRecord | undefined
  for (const file of files) {
    if (file.name !== name) continue
    if (match) return undefined
    match = file
  }
  return match
}

/** A file answering to `reference` as an id, as a VFS path, or by name. */
function findFileByReference(
  files: readonly WorkspaceFileRecord[],
  reference: string | undefined
): WorkspaceFileRecord | undefined {
  if (!reference) return undefined
  return (
    files.find((file) => file.id === reference) ??
    findWorkspaceFileByPath(files, reference) ??
    findFileByUniqueName(files, reference)
  )
}

/**
 * Turns a chip's best-effort reference into a resource the panel can open, or
 * null when nothing identifies it.
 *
 * A file chip's reference is lossy — the agent writes the tag by hand, and
 * rendering it as a link collapses id and path into one value — so each
 * candidate is tried against every interpretation. The match must be a file
 * this workspace actually has: an id the client's list has not caught up with
 * resolves once the caller refetches, and one that never resolves was never an
 * id. Trusting an unverified id would open a tab pointing at nothing, which is
 * the state this whole path exists to prevent.
 */
export function resolveWorkspaceResourceRef(
  ref: WorkspaceResourceRef,
  files: readonly WorkspaceFileRecord[]
): MothershipResource | null {
  const id = ref.id?.trim()
  const path = ref.path?.trim()
  if (ref.type !== 'file') {
    return id ? { type: ref.type, id, title: ref.title } : null
  }

  let match: WorkspaceFileRecord | undefined
  for (const candidate of [id, path, ref.title.trim()]) {
    match = findFileByReference(files, candidate)
    if (match) break
  }
  if (!match) return null

  return {
    type: 'file',
    id: match.id,
    title: ref.title || match.name,
    // Always the matched file's canonical path, never the reference we were
    // handed — the viewer reads this as a real path.
    path: canonicalWorkspaceFilePath({ folderPath: match.folderPath, name: match.name }),
  }
}

/**
 * The longest leading part of `name` a search query can carry, never splitting a surrogate pair:
 * a lone surrogate would match nothing and hide the name's duplicates.
 */
function searchablePrefix(name: string): string {
  if (name.length <= V2_SEARCH_MAX_LENGTH) return name
  const cut = name.slice(0, V2_SEARCH_MAX_LENGTH)
  const last = cut.charCodeAt(cut.length - 1)
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd()
}

/** The most files a chip's name candidate is checked against for ambiguity. */
const NAME_CANDIDATE_LIMIT = 50

/** The values a file chip may be identified by, in the order they are tried. */
function fileRefCandidates(ref: WorkspaceResourceRef): string[] {
  return [
    ...new Set(
      [ref.id?.trim(), ref.path?.trim(), ref.title.trim()].filter((value): value is string =>
        Boolean(value)
      )
    ),
  ]
}

/**
 * The reads that together hold every file a chip's candidates can match under
 * {@link resolveWorkspaceResourceRef}'s rules: each candidate as a reference (an exact id
 * resolves first, then an exact VFS path), and — for a candidate that could be a bare name —
 * every file whose name contains it, so a name shared by two files is still seen as ambiguous.
 * A name longer than a search query may be is searched by its leading part, which every file of
 * that exact name contains and ranks first.
 */
function fileRefReads(queryClient: QueryClient, workspaceId: string, ref: WorkspaceResourceRef) {
  return fileRefCandidates(ref).flatMap((candidate) => [
    getWorkspaceFileLookupQueryOptions(queryClient, workspaceId, 'reference', candidate),
    ...(candidate.includes('/')
      ? []
      : [
          getWorkspaceFileSearchQueryOptions(workspaceId, {
            q: searchablePrefix(candidate),
            limit: NAME_CANDIDATE_LIMIT,
          }),
        ]),
  ])
}

/**
 * Resolves a chip against the workspace's live files, fetching only the handful of files its
 * candidates can name rather than the workspace's list. `fresh` re-reads them all: a chip may
 * name a file the agent created a moment ago, which a cached miss would hide. Rejects when a
 * read fails, so "we could not look" stays distinct from "it is not there".
 */
export async function fetchWorkspaceResourceRef(
  queryClient: QueryClient,
  workspaceId: string,
  ref: WorkspaceResourceRef,
  options?: { fresh?: boolean }
): Promise<MothershipResource | null> {
  if (ref.type !== 'file') return resolveWorkspaceResourceRef(ref, [])
  const reads = await Promise.all(
    fileRefReads(queryClient, workspaceId, ref).map((read) =>
      queryClient.fetchQuery<WorkspaceFileRecord | WorkspaceFileRecord[] | null>({
        ...read,
        ...(options?.fresh ? { staleTime: 0 } : {}),
      })
    )
  )
  return resolveWorkspaceResourceRef(ref, distinctFiles(reads))
}

/**
 * {@link fetchWorkspaceResourceRef} from the cache alone: the resolved resource, `null` when the
 * cached reads name no file, or `undefined` when a read it needs has not been cached yet.
 */
export function readCachedWorkspaceResourceRef(
  queryClient: QueryClient,
  workspaceId: string,
  ref: WorkspaceResourceRef
): MothershipResource | null | undefined {
  if (ref.type !== 'file') return resolveWorkspaceResourceRef(ref, [])
  const reads: (WorkspaceFileRecord | WorkspaceFileRecord[] | null)[] = []
  for (const read of fileRefReads(queryClient, workspaceId, ref)) {
    const data = queryClient.getQueryData<WorkspaceFileRecord | WorkspaceFileRecord[] | null>(
      read.queryKey
    )
    if (data === undefined) return undefined
    reads.push(data)
  }
  return resolveWorkspaceResourceRef(ref, distinctFiles(reads))
}
