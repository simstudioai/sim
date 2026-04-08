import { Blimp, Database, Folder as FolderIcon, Table as TableIcon } from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'

interface ContextMentionIconProps {
  context: ChatMessageContext
  /** Only used when context.kind is 'workflow' or 'current_workflow'; ignored otherwise. */
  workflowColor?: string | null
  /** Applied to every icon element. Include sizing and positional classes (e.g. h-[12px] w-[12px]). */
  className: string
}

/** Renders the icon for a context mention chip. Returns null when no icon applies. */
export function ContextMentionIcon({ context, workflowColor, className }: ContextMentionIconProps) {
  switch (context.kind) {
    case 'workflow':
    case 'current_workflow':
      return workflowColor ? (
        <span
          className={cn('rounded-[3px] border-[2px]', className)}
          style={{
            backgroundColor: workflowColor,
            borderColor: workflowBorderColor(workflowColor),
            backgroundClip: 'padding-box',
          }}
        />
      ) : null
    case 'knowledge':
      return <Database className={className} />
    case 'table':
      return <TableIcon className={className} />
    case 'file': {
      const FileDocIcon = getDocumentIcon('', context.label)
      return <FileDocIcon className={className} />
    }
    case 'folder':
      return <FolderIcon className={className} />
    case 'past_chat':
      return <Blimp className={className} />
    default:
      return null
  }
}
