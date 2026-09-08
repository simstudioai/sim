'use client'

import { Workflow } from '@sim/emcn/icons'
import { ResourceMention } from '@/app/workspace/[workspaceId]/home/components/message-content/components/resource-mention'
import { useSmoothText } from '@/hooks/use-smooth-text'

interface HeroChatReplyProps {
  content: string
  isStreaming: boolean
  onOpenWorkflowResource: () => void
}

const WORKFLOW_TITLE = 'Lead enrichment'

/** The seeded reply uses the native text pacer and resource chip without workspace data queries. */
export function HeroChatReply({
  content,
  isStreaming,
  onOpenWorkflowResource,
}: HeroChatReplyProps) {
  const revealed = useSmoothText(content, isStreaming)
  return (
    <div className='space-y-4 font-[family-name:var(--font-inter)] text-[var(--text-primary)] text-base leading-[25px] tracking-[0] antialiased'>
      {revealed.split('\n\n').map((paragraph, index) => {
        const resourceIndex = paragraph.indexOf(WORKFLOW_TITLE)
        return (
          <p key={index}>
            {resourceIndex < 0 ? (
              paragraph
            ) : (
              <>
                {paragraph.slice(0, resourceIndex)}
                <ResourceMention
                  icon={
                    <Workflow className='relative top-0.5 size-[12px] shrink-0 text-[var(--text-icon)]' />
                  }
                  title={WORKFLOW_TITLE}
                  onSelect={onOpenWorkflowResource}
                />
                {paragraph.slice(resourceIndex + WORKFLOW_TITLE.length)}
              </>
            )}
          </p>
        )
      })}
    </div>
  )
}
