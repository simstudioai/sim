import type { Principal } from '@sim/auth/principal'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { resolveDocumentRender } from '@/lib/uploads/documents'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'

/**
 * Resolves a generation-source record to its compiled artifact.
 *
 * The record's declared size bounds nothing here — a source is text and orders
 * of magnitude smaller than what it renders to — so the artifact is checked
 * against the ceiling the caller is serving under. Note this rejects an
 * oversized artifact while reading it: the artifact store fetch enforces the
 * byte ceiling and forwards cancellation to the underlying download.
 *
 * An artifact that is still compiling is retryable rather than a fault, so it
 * surfaces as `conflict` — a 500 would give the caller no reason to try again.
 * A generation script that failed permanently raises the same error class but
 * will never succeed on a retry, so it keeps its own message instead of the
 * "still being generated" copy, which would tell the caller to wait for an
 * artifact that never appears. It stays a `conflict` only because the v2
 * envelope has no 422; the message is what distinguishes the two.
 *
 * Shared by every surface that reads a workspace file's bytes, because
 * dispatching on the stored name alone hands back generator source under a
 * document extension — as text, as a download, or as a parse.
 */
export async function resolveRenderedWorkspaceArtifact(
  file: WorkspaceFileRecord,
  filePrincipal: Principal,
  options: { maxBytes: number; signal?: AbortSignal; tooLargeMessage?: (limit: string) => string }
): Promise<{ buffer: Buffer; contentType: string }> {
  return resolveDocumentRender(file.name, options, () =>
    fetchAuthorizedServableWorkspaceFileBuffer(file, filePrincipal, {
      maxBytes: options.maxBytes,
      signal: options.signal,
    })
  )
}
