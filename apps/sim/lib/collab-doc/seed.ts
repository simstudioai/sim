import * as Y from 'yjs'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { markdownToYDoc } from './converter'

/**
 * The largest file we will build a collaborative seed for. Beyond this the editor uses its
 * non-collaborative path anyway; converting a huge document server-side would be wasted work.
 */
const MAX_SEED_BYTES = 5 * 1024 * 1024

/** A collaborative document's initial state, encoded as a Yjs update the relay can apply. */
export interface FileDocSeed {
  /** `Y.encodeStateAsUpdate` of the seeded document — apply with `Y.applyUpdate`. */
  update: Uint8Array
}

/**
 * Build the server-side seed for a file's collaborative document: load the file's current markdown
 * and convert it — through the exact client engine (see {@link markdownToYDoc}) — into a Yjs update.
 *
 * This is what makes seeding server-authoritative: the realtime relay applies this to a fresh room's
 * document instead of electing a client to import the content, so the whole client-seeder subsystem
 * (election / deadlines / retries) goes away. The frontmatter is stripped exactly as the client's
 * seed did — it is file metadata, not part of the collaborative body.
 *
 * Returns `null` when the file is missing/deleted (the caller treats it as an empty document).
 */
export async function buildFileDocSeed(
  workspaceId: string,
  fileId: string
): Promise<FileDocSeed | null> {
  const record = await getWorkspaceFile(workspaceId, fileId)
  if (!record) return null

  const buffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_SEED_BYTES })
  const markdown = buffer.toString('utf-8')
  const { body } = splitFrontmatter(markdown)

  const ydoc = markdownToYDoc(body)
  try {
    return { update: Y.encodeStateAsUpdate(ydoc) }
  } finally {
    ydoc.destroy()
  }
}
