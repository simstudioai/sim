import { isPlainRecord } from '@sim/utils/object'
import type { PersistedContentBlock } from '@/lib/api/contracts/copilot-messages'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { rewriteForkContentRefs } from '@/ee/workspace-forking/lib/remap/remap-content-refs'

/**
 * Old->new translation tables produced while copying a chat's files
 * (`planChatFileCopies`): row ids (view-URLs, attachment ids, resource ids,
 * context chips) and storage keys (serve-URLs, attachment keys).
 */
export interface ChatFileRefMaps {
  fileIds: ReadonlyMap<string, string>
  fileKeys: ReadonlyMap<string, string>
  /**
   * The workspace both chats live in. A fork stays in its source's workspace, so in-app
   * `/workspace/<id>/files/<fileId>` links keep their workspace and only the file id moves.
   */
  workspaceId?: string | null
}

/**
 * The copy plan's id/key maps restricted to copies whose bytes were prepared. A failed copy
 * is never published, so the fork's messages, resources and worker history keep naming the
 * source file (alive while the source chat is) instead of an id or key that never exists.
 */
export function publishedFileRefMaps(
  plan: {
    idMap: ReadonlyMap<string, string>
    keyMap: ReadonlyMap<string, string>
    blobTasks: readonly { copyId: string; targetKey: string }[]
  },
  failedCopyIds: ReadonlySet<string>
): { fileIds: Map<string, string>; fileKeys: Map<string, string> } {
  const failedKeys = new Set(
    plan.blobTasks.filter((task) => failedCopyIds.has(task.copyId)).map((task) => task.targetKey)
  )
  return {
    fileIds: new Map([...plan.idMap].filter(([, copyId]) => !failedCopyIds.has(copyId))),
    fileKeys: new Map([...plan.keyMap].filter(([, copyKey]) => !failedKeys.has(copyKey))),
  }
}

function hasMappings(maps: ChatFileRefMaps): boolean {
  return maps.fileIds.size > 0 || maps.fileKeys.size > 0
}

function rewriteText(text: string, maps: ChatFileRefMaps): string {
  return rewriteForkContentRefs(text, {
    fileIds: maps.fileIds,
    fileKeys: maps.fileKeys,
    ...(maps.workspaceId ? { workspaceId: { from: maps.workspaceId, to: maps.workspaceId } } : {}),
  })
}

/**
 * Tool arguments name a file by its bare id or storage key (`{ fileId }`, `["files", "read", id]`),
 * so a string that IS a mapped id or key is replaced whole; any other string gets the URL grammar.
 */
function rewriteToolValue(value: unknown, maps: ChatFileRefMaps): unknown {
  if (typeof value === 'string')
    return maps.fileIds.get(value) ?? maps.fileKeys.get(value) ?? rewriteText(value, maps)
  if (Array.isArray(value)) return value.map((entry) => rewriteToolValue(entry, maps))
  if (isPlainRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteToolValue(entry, maps)])
    )
  return value
}

function rewriteBlock(block: PersistedContentBlock, maps: ChatFileRefMaps): PersistedContentBlock {
  const toolCall = block.toolCall
  return {
    ...block,
    ...(block.content ? { content: rewriteText(block.content, maps) } : {}),
    ...(toolCall
      ? {
          toolCall: {
            ...toolCall,
            ...(toolCall.params
              ? { params: rewriteToolValue(toolCall.params, maps) as Record<string, unknown> }
              : {}),
            ...(toolCall.activityDescription
              ? { activityDescription: rewriteText(toolCall.activityDescription, maps) }
              : {}),
            ...(toolCall.display?.title
              ? {
                  display: {
                    ...toolCall.display,
                    title: rewriteText(toolCall.display.title, maps),
                  },
                }
              : {}),
          },
        }
      : {}),
  }
}

/**
 * Re-point every file reference in a copied transcript at the copied files, so
 * the fork is self-contained (it survives the original chat's deletion).
 * Rewrites: free-text URLs in `content` and text content blocks (serve/view/
 * in-app/`sim:file` forms, via the shared fork grammar), tool-call arguments
 * and display text, attachment chip ids+keys, and `@`-mention context chip
 * file ids. References to anything not
 * in the maps (shared workspace files, workflows, other chats) pass through
 * unchanged. Pure; returns the input array untouched when there is nothing to
 * rewrite.
 *
 * Pass-through cannot leave the fork pointing at uncopied CHAT-OWNED files:
 * a message can only reference files that existed when it was written, every
 * chat-owned file is stamped with the user message of the turn it was born in
 * (NULL-stamped legacy rows are copied into every fork), and the fork copies
 * every chat-owned file born at-or-before the cut — so any chat-owned file a
 * kept message references is always in the maps. The only reachable leftovers
 * are files soft-deleted before the fork, whose links are equally dead in the
 * source chat.
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
      rewritten.contentBlocks = message.contentBlocks.map((block) => rewriteBlock(block, maps))
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
 * `dropFileIds` is the source chat's chat-owned file ids (no timeline cut).
 * A file resource pointing at one of these that was NOT copied is a ghost in
 * the new chat — its file stays behind (an upload born after the cut) — so it
 * is dropped rather than left pointing at the source chat's file. Shared
 * workspace files are not chat-owned, never appear in the set, and pass
 * through unchanged.
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
