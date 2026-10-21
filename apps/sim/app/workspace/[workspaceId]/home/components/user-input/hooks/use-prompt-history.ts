import { useCallback, useRef } from 'react'
import { toast } from '@sim/emcn'
import {
  getMothershipAttachmentPreviewUrl,
  getMothershipAttachmentUrl,
} from '@/lib/mothership/chat/attachment-preview'
import { UNAVAILABLE_CONTEXT_NOTICE } from '@/lib/mothership/chat/context'
import type { PromptEditorInstance } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'
import type { AttachedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import type { ChatContext } from '@/stores/panel'

interface UsePromptHistoryProps {
  editor: PromptEditorInstance
  attachedFiles: AttachedFile[]
  restoreAttachedFiles: (files: AttachedFile[]) => void
  getMessages?: () => readonly ChatMessage[]
}

interface HistoryPosition {
  id: string
  index: number
  value: string
  contexts: ChatContext[]
  files: AttachedFile[]
}

/** Browses loaded user turns on demand, stopping as soon as the recalled draft is edited. */
export function usePromptHistory(props: UsePromptHistoryProps) {
  const latest = useRef(props)
  latest.current = props
  const position = useRef<HistoryPosition | null>(null)

  const reset = useCallback(() => {
    position.current = null
  }, [])

  const navigate = useCallback((direction: -1 | 1): boolean => {
    const { editor, attachedFiles, restoreAttachedFiles, getMessages } = latest.current
    let current = position.current
    if (
      current &&
      (editor.getValue() !== current.value ||
        editor.contexts !== current.contexts ||
        attachedFiles !== current.files)
    ) {
      position.current = null
      current = null
    }
    if (!current && (direction === 1 || editor.getValue() || attachedFiles.length > 0)) {
      return false
    }
    const messages = getMessages?.()
    if (!messages?.length) return false
    let index = current
      ? messages[current.index]?.id === current.id
        ? current.index
        : messages.findIndex((message) => message.id === current.id)
      : messages.length
    if (current && index < 0) {
      position.current = null
      return false
    }
    index += direction
    while (index >= 0 && index < messages.length) {
      const message = messages[index]
      if (
        message.role === 'user' &&
        !message.origin &&
        (message.content || message.fileAttachments?.length)
      ) {
        const files = (message.fileAttachments ?? []).map((attachment) => ({
          id: attachment.id,
          key: attachment.key,
          name: attachment.filename,
          type: attachment.media_type,
          size: attachment.size,
          path: getMothershipAttachmentUrl(attachment),
          uploading: false,
          previewUrl: getMothershipAttachmentPreviewUrl(attachment),
        }))
        const { value, contexts, hasUnavailableContexts } = editor.restorePrompt(
          message.content,
          message.contexts
        )
        if (hasUnavailableContexts) {
          toast.info(UNAVAILABLE_CONTEXT_NOTICE)
        }
        restoreAttachedFiles(files)
        editor.pendingCursorRef.current = direction === -1 ? 0 : value.length
        position.current = { id: message.id, index, value, contexts, files }
        return true
      }
      index += direction
    }
    if (current && direction === 1) {
      editor.clear()
      restoreAttachedFiles([])
      position.current = null
      return true
    }
    return current !== null
  }, [])

  return { navigate, reset }
}
