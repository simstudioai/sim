import { isUserFile } from '@/lib/core/utils/user-file'
import {
  type AppsFileCapabilityClaims,
  type AppsPublicFile,
  toAppsPublicFile,
} from '@/lib/apps/file-capability'
import { sanitizePublicValue } from '@/lib/interfaces/compiler/output-response'

export type AppsOutputMaterializeContext = {
  workspaceId: string
  workflowId: string
  executionId: string
  projectId?: string
  releaseId?: string
  previewSessionId?: string
}

function materializeUserFile(
  value: unknown,
  ctx: AppsOutputMaterializeContext
): AppsPublicFile | unknown {
  if (!isUserFile(value)) return value

  const file = value as {
    id: string
    name: string
    url: string
    key: string
    size?: number
    type?: string
  }

  // Only rewrite execution-scoped files we can authorize via key ownership.
  if (!file.key.startsWith(`execution/${ctx.workspaceId}/${ctx.workflowId}/${ctx.executionId}/`)) {
    // Drop internal storage pointers; do not expose foreign/presigned URLs.
    return {
      url: '',
      name: file.name,
      mimeType: typeof file.type === 'string' ? file.type : 'application/octet-stream',
      size: typeof file.size === 'number' ? file.size : 0,
    } satisfies AppsPublicFile
  }

  const claims: Omit<AppsFileCapabilityClaims, 'exp'> = {
    workspaceId: ctx.workspaceId,
    workflowId: ctx.workflowId,
    executionId: ctx.executionId,
    fileKey: file.key,
    name: file.name,
    mimeType: typeof file.type === 'string' && file.type ? file.type : 'application/octet-stream',
    size: typeof file.size === 'number' ? file.size : 0,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    ...(ctx.releaseId ? { releaseId: ctx.releaseId } : {}),
    ...(ctx.previewSessionId ? { previewSessionId: ctx.previewSessionId } : {}),
  }

  return toAppsPublicFile(claims)
}

function walk(
  value: unknown,
  ctx: AppsOutputMaterializeContext,
  seen: WeakSet<object>
): unknown {
  if (value == null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (isUserFile(value)) {
    return materializeUserFile(value, ctx)
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, ctx, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    // Strip internal UserFile fields if a partial object slipped through.
    if (key === 'key' || key === 'context' || key === 'base64' || key === 'remoteUrl') {
      continue
    }
    out[key] = walk(nested, ctx, seen)
  }
  return out
}

/**
 * Public Apps output boundary: sanitize LargeValueRefs, then replace UserFile
 * objects with signed same-origin `/__sim/files/...` capabilities.
 */
export function materializeAppsPublicOutputs(
  value: unknown,
  ctx: AppsOutputMaterializeContext
): unknown {
  const sanitized = sanitizePublicValue(value)
  return walk(sanitized, ctx, new WeakSet<object>())
}
