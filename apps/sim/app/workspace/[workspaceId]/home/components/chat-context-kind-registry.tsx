import type { ReactNode } from 'react'
import {
  Blimp,
  Database,
  Folder as FolderIcon,
  Library,
  Table as TableIcon,
} from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import type { ChatContextKind, ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'

interface RenderIconArgs {
  context: ChatMessageContext
  className: string
  workflowColor?: string | null
}

interface ChatContextKindConfig {
  /** Human label for the kind (used in tooltips / accessible names). */
  label: string
  /** Renders the chip icon. Returns null when no icon should be shown for this kind. */
  renderIcon: (args: RenderIconArgs) => ReactNode | null
}

function renderWorkflowSquare({ className, workflowColor }: RenderIconArgs): ReactNode | null {
  if (!workflowColor) return null
  return (
    <span
      className={cn('rounded-[3px] border-[2px]', className)}
      style={{
        backgroundColor: workflowColor,
        borderColor: workflowBorderColor(workflowColor),
        backgroundClip: 'padding-box',
      }}
    />
  )
}

/**
 * Single source of truth for the icon and label associated with each
 * {@link ChatContextKind}. The `Record<ChatContextKind, …>` typing forces a
 * compile error whenever a new kind is added to the union without a
 * corresponding entry here, preventing the chip from silently rendering
 * without an icon.
 */
export const CHAT_CONTEXT_KIND_REGISTRY: Record<ChatContextKind, ChatContextKindConfig> = {
  workflow: { label: 'Workflow', renderIcon: renderWorkflowSquare },
  current_workflow: { label: 'Current workflow', renderIcon: renderWorkflowSquare },
  workflow_block: { label: 'Block', renderIcon: renderWorkflowSquare },
  blocks: { label: 'Blocks', renderIcon: () => null },
  knowledge: {
    label: 'Knowledge base',
    renderIcon: ({ className }) => <Database className={className} />,
  },
  table: {
    label: 'Table',
    renderIcon: ({ className }) => <TableIcon className={className} />,
  },
  file: {
    label: 'File',
    renderIcon: ({ context, className }) => {
      const FileDocIcon = getDocumentIcon('', context.label)
      return <FileDocIcon className={className} />
    },
  },
  folder: {
    label: 'Folder',
    renderIcon: ({ className }) => <FolderIcon className={className} />,
  },
  past_chat: {
    label: 'Past chat',
    renderIcon: ({ className }) => <Blimp className={className} />,
  },
  logs: {
    label: 'Logs',
    renderIcon: ({ className }) => <Library className={className} />,
  },
  templates: { label: 'Templates', renderIcon: () => null },
  docs: { label: 'Docs', renderIcon: () => null },
  slash_command: { label: 'Command', renderIcon: () => null },
}
