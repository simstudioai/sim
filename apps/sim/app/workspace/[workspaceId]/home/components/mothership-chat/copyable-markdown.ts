import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import { parseSpecialTags } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

export function toCopyableMarkdown(raw: string): string {
  const displayContent = sanitizeChatDisplayContent(raw)
  const { segments } = parseSpecialTags(displayContent, false)

  return segments
    .reduce((markdown, segment) => {
      return segment.type === 'text' ? markdown + segment.content : markdown
    }, '')
    .trim()
}
