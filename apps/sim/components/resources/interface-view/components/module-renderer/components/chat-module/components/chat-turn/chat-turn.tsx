'use client'

import { memo, useMemo } from 'react'
import { cn } from '@sim/emcn'
import { ChatContent } from '@/components/chat/chat-content'
import { ChatCopyButton } from '@/components/chat/chat-copy-button'
import { ChatMessageAttachments } from '@/components/chat/chat-message-attachments'
import { CHAT_ACTION_ROW_GAP, CHAT_TURN_LAYOUT } from '@/components/chat/turn-layout'
import type { ChatMessageAttachment } from '@/components/chat/types'
import { UserMessageContent } from '@/components/chat/user-message-content'
import { MODULE_GUTTER_X } from '@/components/resources/interface-view/module-chrome'
import { ChatFileDownload } from '@/app/(interfaces)/chat/components/message/components/file-download'
import type {
  ChatAttachment,
  ChatMessage,
} from '@/app/(interfaces)/chat/components/message/message'

/** A chat module sits in a canvas cell, so it wears the panel-width rhythm. */
const TURN = CHAT_TURN_LAYOUT.narrow

/**
 * A turn's text as markdown. An interface chat's content is a string in every
 * real case — the run resolver joins its parts before the turn is built — but
 * the transcript type still admits a raw object, which is fenced rather than
 * dumped so it lands in the same code block the Sim chat would draw for it.
 */
function toMarkdown(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return ['```json', JSON.stringify(content, null, 2), '```'].join('\n')
}

/**
 * Composer attachments in the shape the shared strip renders.
 *
 * A preview is offered only for media the browser can actually paint inline,
 * and only when the composer pre-read it: everything else falls through to the
 * named pill, which is the same degradation the Sim chat shows for a document.
 */
function toAttachmentStrip(attachments: readonly ChatAttachment[]): ChatMessageAttachment[] {
  return attachments.map((attachment) => {
    const isMedia = attachment.type.startsWith('image/') || attachment.type.startsWith('video/')
    const preview = isMedia && attachment.dataUrl ? attachment.dataUrl : undefined
    return {
      id: attachment.id,
      filename: attachment.name,
      media_type: attachment.type,
      size: attachment.size ?? 0,
      previewUrl: preview,
    }
  })
}

export interface ChatTurnProps {
  message: ChatMessage
}

/**
 * One turn of an interface chat module, drawn with the Sim chat's own
 * renderers: {@link UserMessageContent} in the shared bubble for what the
 * visitor sent, {@link ChatContent} for what the workflow streamed back.
 *
 * Mounting those rather than re-drawing them is the whole point — markdown,
 * code highlighting, tables, links, the word-paced stream reveal, and the
 * bubble's own metrics are then defined once and cannot drift between the two
 * surfaces.
 *
 * `ChatContent`'s `renderSpecialTags` seam is deliberately left empty here: the
 * special tags are the Sim agent's protocol, and a chat module runs a user's
 * workflow, which streams markdown and nothing else.
 */
export const ChatTurn = memo(function ChatTurn({ message }: ChatTurnProps) {
  const markdown = toMarkdown(message.content)
  const attachments = useMemo(
    () => toAttachmentStrip(message.attachments ?? []),
    [message.attachments]
  )

  if (message.type === 'user') {
    return (
      <div className={cn(TURN.userRow, TURN.rowGap, MODULE_GUTTER_X)}>
        {attachments.length > 0 && (
          <ChatMessageAttachments
            attachments={attachments}
            align='end'
            className={TURN.attachmentWidth}
          />
        )}
        {markdown.trim() && (
          <div className={TURN.userBubble}>
            <UserMessageContent content={markdown} />
          </div>
        )}
      </div>
    )
  }

  const files = message.files ?? []

  return (
    <div className={cn(TURN.assistantRow, TURN.rowGap, MODULE_GUTTER_X)}>
      <ChatContent content={markdown} isStreaming={message.isStreaming} />
      {files.length > 0 && (
        <div className='mt-3 flex flex-wrap gap-2'>
          {files.map((file) => (
            <ChatFileDownload key={file.id} file={file} />
          ))}
        </div>
      )}
      {!message.isStreaming && !message.isInitialMessage && markdown.trim() && (
        <div className={CHAT_ACTION_ROW_GAP}>
          <ChatCopyButton content={markdown} />
        </div>
      )}
    </div>
  )
})
