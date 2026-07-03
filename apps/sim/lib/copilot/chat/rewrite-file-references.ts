import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { rewriteForkContentRefs } from '@/lib/workspaces/fork/remap/remap-content-refs'

/**
 * Old->new translation tables produced while copying a chat's files
 * (`planChatFileCopies`): row ids (view-URLs, attachment ids, resource ids,
 * context chips) and storage keys (serve-URLs, attachment keys).
 */
export interface ChatFileRefMaps {
  fileIds: ReadonlyMap<string, string>
  fileKeys: ReadonlyMap<string, string>
}

function hasMappings(maps: ChatFileRefMaps): boolean {
  return maps.fileIds.size > 0 || maps.fileKeys.size > 0
}

function rewriteText(text: string, maps: ChatFileRefMaps): string {
  return rewriteForkContentRefs(text, { fileIds: maps.fileIds, fileKeys: maps.fileKeys })
}

/**
 * Re-point every file reference in a copied transcript at the copied files, so
 * the duplicate is self-contained (it survives the original chat's deletion).
 * Rewrites: free-text URLs in `content` and text content blocks (serve/view/
 * in-app/`sim:file` forms, via the shared fork grammar), attachment chip
 * ids+keys, and `@`-mention context chip file ids. References to anything not
 * in the maps (shared workspace files, workflows, other chats) pass through
 * unchanged. Pure; returns the input array untouched when there is nothing to
 * rewrite.
 */
export function rewriteMessageFileRefs(
  messages: PersistedMessage[],
  maps: ChatFileRefMaps
): PersistedMessage[] {
  if (!hasMappings(maps)) return messages
  return messages.map((message) => {
    const rewritten: PersistedMessage = {
      ...message,
      content: rewriteText(message.content, maps),
    }
    if (message.contentBlocks?.length) {
      rewritten.contentBlocks = message.contentBlocks.map((block) =>
        block.content ? { ...block, content: rewriteText(block.content, maps) } : block
      )
    }
    if (message.fileAttachments?.length) {
      rewritten.fileAttachments = message.fileAttachments.map((att) => ({
        ...att,
        id: maps.fileIds.get(att.id) ?? att.id,
        key: maps.fileKeys.get(att.key) ?? att.key,
      }))
    }
    if (message.contexts?.length) {
      rewritten.contexts = message.contexts.map((ctx) =>
        ctx.fileId ? { ...ctx, fileId: maps.fileIds.get(ctx.fileId) ?? ctx.fileId } : ctx
      )
    }
    return rewritten
  })
}

/**
 * Re-point `file`-typed resource entries (the chat's attached-resources list
 * stores raw `workspace_files.id`s) at the copied files. Non-file resources
 * (workflows, tables, knowledge bases…) reference shared workspace entities
 * and pass through unchanged.
 *
 * `dropFileIds` is the source chat's chat-owned file ids (uploads + outputs).
 * A file resource pointing at one of these that was NOT copied is a ghost in
 * the new chat — its file stays behind on a branch fork (outputs always,
 * uploads born after the cut) — so it is dropped rather than left pointing at
 * the source chat's file. Shared workspace files are not chat-owned, never
 * appear in the set, and pass through unchanged.
 */
export function rewriteResourceFileRefs(
  resources: MothershipResource[],
  maps: ChatFileRefMaps,
  dropFileIds?: ReadonlySet<string>
): MothershipResource[] {
  if (!hasMappings(maps) && !dropFileIds?.size) return resources
  return resources.flatMap((resource) => {
    if (resource.type !== 'file') return [resource]
    const copyId = maps.fileIds.get(resource.id)
    if (copyId) return [{ ...resource, id: copyId }]
    if (dropFileIds?.has(resource.id)) return []
    return [resource]
  })
}
