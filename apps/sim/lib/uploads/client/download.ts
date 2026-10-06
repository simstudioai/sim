import { PASTE_LIMITS, utf8ByteLength } from '@sim/utils/paste'
import { requestRaw } from '@/lib/api/client/request'
import {
  downloadProjectFileItemsContract,
  exportProjectFileSnapshotContract,
} from '@/lib/api/contracts/project-file-downloads'
import {
  type ProjectFileRecord,
  readProjectFileArtifactContract,
  readProjectFileContentContract,
} from '@/lib/api/contracts/project-files'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { exportWorkspaceFileSnapshotContract } from '@/lib/api/contracts/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/** Action-time content from the mounted viewer, scoped so another file cannot consume it. */
export type FileDownloadSource = {
  fileId: string
  getContent: () => string | null
} & (
  | { workspaceId: string; owner?: never }
  | { owner: { entityType: 'project'; entityId: string }; workspaceId?: never }
)

interface FileDownloadAdapter {
  exportSnapshot: (ownerId: string, fileId: string, content: string) => Promise<Response>
  downloadArchive: (ownerId: string, fileIds: string[], folderIds: string[]) => Promise<Response>
  archiveName: string
}

const OWNER_DOWNLOADS: FileOwnerAdapters<FileDownloadAdapter> = {
  workspace: {
    exportSnapshot: (ownerId, fileId, content) =>
      requestRaw(
        exportWorkspaceFileSnapshotContract,
        { params: { id: ownerId, fileId }, body: { content } },
        { cache: 'no-store' }
      ),
    downloadArchive: (ownerId, fileIds, folderIds) =>
      requestRaw(
        downloadWorkspaceFileItemsContract,
        { params: { id: ownerId }, query: { fileIds, folderIds } },
        { cache: 'no-store' }
      ),
    archiveName: 'workspace-files.zip',
  },
  project: {
    exportSnapshot: (ownerId, fileId, content) =>
      requestRaw(
        exportProjectFileSnapshotContract,
        { params: { id: ownerId, fileId }, body: { content } },
        { cache: 'no-store' }
      ),
    downloadArchive: (ownerId, fileIds, folderIds) =>
      requestRaw(
        downloadProjectFileItemsContract,
        { params: { id: ownerId }, query: { fileIds, folderIds } },
        { cache: 'no-store' }
      ),
    archiveName: 'project-files.zip',
  },
}

function isMarkdownFile(record: { type: string; name: string }): boolean {
  return (
    record.type === 'text/markdown' ||
    record.type === 'text/x-markdown' ||
    /\.(?:md|markdown)$/i.test(record.name)
  )
}

async function downloadMarkdownSnapshot(
  owner: EditableFileOwner,
  record: { id: string; name: string },
  source?: FileDownloadSource | null
): Promise<boolean> {
  if (!source || source.fileId !== record.id) return false
  const sourceOwner = source.owner ?? {
    entityType: 'workspace',
    entityId: source.workspaceId,
  }
  if (sourceOwner.entityType !== owner.entityType || sourceOwner.entityId !== owner.entityId) {
    return false
  }
  const content = source.getContent()
  if (content === null) return false
  await exportMarkdownSnapshot(owner, record, content)
  return true
}

async function exportMarkdownSnapshot(
  owner: EditableFileOwner,
  record: { id: string; name: string },
  content: string
): Promise<void> {
  // Source editing accepts larger drafts than the bounded image-bundling endpoint.
  if (
    utf8ByteLength(content, PASTE_LIMITS.RICH_MARKDOWN_BYTES) > PASTE_LIMITS.RICH_MARKDOWN_BYTES
  ) {
    saveBlob(new Blob([content], { type: 'text/markdown; charset=utf-8' }), record.name)
    return
  }
  const adapter = requireFileOwnerAdapter(OWNER_DOWNLOADS, owner)
  const response = await adapter.exportSnapshot(owner.entityId, record.id, content)
  saveBlob(await response.blob(), fileNameFromDisposition(response, record.name))
}

export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  // Attached before clicking: a detached anchor works in current browsers, but every
  // other download helper in the app attaches, and a silent no-op here would look
  // exactly like a download that never started.
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Deferred: revoking synchronously after click() can race the download starting.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function fileNameFromDisposition(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // Fall through to the plain form.
    }
  }
  return disposition.match(/filename="([^"]+)"/)?.[1] ?? fallback
}

export async function triggerFileDownload(
  record: WorkspaceFileRecord,
  source?: FileDownloadSource | null
): Promise<void> {
  const isMarkdown = isMarkdownFile(record)
  if (
    isMarkdown &&
    record.vfsNamespace !== 'uploads' &&
    (record.storageContext ?? 'workspace') === 'workspace' &&
    (await downloadMarkdownSnapshot(
      { entityType: 'workspace', entityId: record.workspaceId },
      record,
      source
    ))
  ) {
    return
  }

  const url =
    isMarkdown &&
    record.vfsNamespace !== 'uploads' &&
    (record.storageContext ?? 'workspace') === 'workspace'
      ? `/api/files/export/${encodeURIComponent(record.id)}`
      : `/api/files/serve/${encodeURIComponent(record.key)}?context=${record.storageContext ?? 'workspace'}&t=${Date.now()}`

  // boundary-raw-fetch: binary download read as a blob; these paths have no contract
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to download "${record.name}"`)

  saveBlob(await response.blob(), fileNameFromDisposition(response, record.name))
}

/** Downloads the selected Project's rendered artifact, preserving an open Markdown draft. */
export async function triggerProjectFileDownload(
  record: ProjectFileRecord,
  source?: FileDownloadSource | null
): Promise<void> {
  if (isMarkdownFile(record)) {
    if (await downloadMarkdownSnapshot(record.owner, record, source)) return
    const response = await requestRaw(
      readProjectFileContentContract,
      { params: { id: record.owner.entityId, fileId: record.id } },
      { cache: 'no-store' }
    )
    await exportMarkdownSnapshot(record.owner, record, await response.text())
    return
  }
  const response = await requestRaw(
    readProjectFileArtifactContract,
    { params: { id: record.owner.entityId, fileId: record.id }, query: {} },
    { cache: 'no-store' }
  )
  saveBlob(await response.blob(), fileNameFromDisposition(response, record.name))
}

/**
 * Download a selection of files as a zip. Fetched rather than navigated to, so a
 * rejection — a document still compiling, an entry too large — surfaces as an error the
 * caller can show in place instead of replacing the page with raw JSON. `requestRaw`
 * throws an `ApiClientError` carrying the route's own message.
 */
export async function triggerArchiveDownload(
  input: { fileIds?: string[]; folderIds?: string[] } & (
    | { workspaceId: string; owner?: never }
    | { owner: EditableFileOwner; workspaceId?: never }
  )
): Promise<void> {
  const owner = input.owner ?? { entityType: 'workspace', entityId: input.workspaceId }
  const adapter = requireFileOwnerAdapter(OWNER_DOWNLOADS, owner)
  const response = await adapter.downloadArchive(
    owner.entityId,
    input.fileIds ?? [],
    input.folderIds ?? []
  )
  saveBlob(await response.blob(), fileNameFromDisposition(response, adapter.archiveName))
}
