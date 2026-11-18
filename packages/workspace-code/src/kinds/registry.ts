/**
 * Every kind's layout, by kind: the one place the server and the CLI reach a kind's paths, keys
 * and traits through, so neither restates a kind's rule (which paths are binary, what a key names).
 * The table kind's content rules depend on the server's column-type catalog, so this registry
 * holds layouts; the server's kind adapters hold the full codecs.
 */
import type { FileKind, KindCodec, KindLayout, WorkspaceKind } from '../kind'
import { kindOfPath } from '../layout'
import { WORKSPACE_KIND_SPECS } from '../specs'
import { credentialCodec } from './credentials'
import { deploymentCodec } from './deployment'
import { fileCodec } from './files'
import { knowledgeCodec } from './knowledge'
import { mcpCodec } from './mcp'
import { secretCodec } from './secrets'
import { skillCodec } from './skills'
import { tableLayout } from './table'
import { toolCodec } from './tools'
import { workflowCodec } from './workflow'

/** The layout of each kind. */
export const KIND_LAYOUTS: { readonly [K in WorkspaceKind]: KindLayout } = {
  secret: secretCodec,
  credential: credentialCodec,
  'custom-tool': toolCodec,
  skill: skillCodec,
  'mcp-server': mcpCodec,
  table: tableLayout,
  'knowledge-base': knowledgeCodec,
  file: fileCodec,
  workflow: workflowCodec,
  deployment: deploymentCodec,
}

/**
 * The codec of each kind that holds blobs, for a client that fingerprints a resource from the
 * bytes it hashed. Neither needs a catalog, so the CLI reads them as the server does.
 */
export const BLOB_KIND_CODECS = {
  'knowledge-base': knowledgeCodec,
  file: fileCodec,
} as const satisfies { readonly [K in WorkspaceKind]?: KindCodec<unknown> }

/**
 * The codec of each kind one root file declares whole, for a client that reads the keys the file
 * declares (to type them in `workspace.d.ts`). Neither needs a catalog.
 */
export const FILE_KIND_CODECS = {
  secret: secretCodec,
  credential: credentialCodec,
} as const satisfies { readonly [K in FileKind]: KindCodec<unknown> }

/** A kind whose layout has blob paths. */
type BlobKind = keyof typeof BLOB_KIND_CODECS

/** Whether `kind` holds blobs, so {@link BLOB_KIND_CODECS} has its codec. */
export function isBlobKind(kind: WorkspaceKind): kind is BlobKind {
  return Object.hasOwn(BLOB_KIND_CODECS, kind)
}

/** Whether `path` holds bytes rather than text, as the layout of the kind whose folder holds it says. */
export function isBlobPath(path: string): boolean {
  const kind = kindOfPath(path)
  return kind !== null && KIND_LAYOUTS[kind].isBlob?.(path) === true
}

/**
 * Whether a kind's keys are its own resource keys, the keys a workflow names a resource by and a
 * write claims (see `WORKSPACE_KIND_SPECS[kind].resourceKind`).
 */
export function isResourceKeyed(kind: WorkspaceKind): boolean {
  return WORKSPACE_KIND_SPECS[kind].resourceKind !== null
}
