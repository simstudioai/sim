/**
 * Every kind's codec, by kind: the one place the server and the CLI reach a kind's files, keys and
 * traits through, so neither restates a kind's rule (which paths are binary, what a key names).
 */
import type { KindCodec, WorkspaceKind } from '../kind'
import { kindOfPath } from '../layout'
import { fileCodec } from './files'
import { knowledgeCodec } from './knowledge'
import { skillCodec } from './skills'
import { tableCodec } from './table'
import { toolCodec } from './tools'
import { workflowCodec } from './workflow'

/** The codec of each kind. */
export const KIND_CODECS: { readonly [K in WorkspaceKind]: KindCodec<unknown> } = {
  'custom-tool': toolCodec,
  skill: skillCodec,
  table: tableCodec,
  'knowledge-base': knowledgeCodec,
  file: fileCodec,
  workflow: workflowCodec,
}

/** Whether `path` holds bytes rather than text, as the codec of the kind whose folder holds it says. */
export function isBlobPath(path: string): boolean {
  const kind = kindOfPath(path)
  return kind !== null && KIND_CODECS[kind].isBlob?.(path) === true
}

/** Whether a kind's keys are resource keys, the keys a workflow names a resource by. */
export function isResourceKeyed(kind: WorkspaceKind): boolean {
  return (KIND_CODECS[kind].keys ?? 'resource') === 'resource'
}
