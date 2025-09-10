import { Notice } from '@/components/ui'
import { cn } from '@/lib/utils'
import { JSONView } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/components'
import type { TriggerConfig } from '@/triggers/types'

interface TriggerInstructionsProps {
  instructions: string[]
  webhookUrl: string
  samplePayload: any
  triggerDef: TriggerConfig
}

export function TriggerInstructions({
  instructions,
  webhookUrl,
  samplePayload,
  triggerDef,
}: TriggerInstructionsProps) {
  return (
    <div className='space-y-4'>
      <div className={cn('mt-4 rounded-md border border-border bg-card/50 p-4 shadow-sm')}>
        <h4 className='mb-3 font-medium text-base'>Setup Instructions</h4>
        <div className='space-y-1 text-muted-foreground text-sm [&_a]:text-muted-foreground [&_a]:underline [&_a]:hover:text-muted-foreground/80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs'>
          <ol className='list-inside list-decimal space-y-2'>
            {instructions.map((instruction, index) => (
              <li key={index} dangerouslySetInnerHTML={{ __html: instruction }} />
            ))}
          </ol>
        </div>
      </div>

      <Notice
        variant='default'
        className='border-slate-200 bg-white dark:border-border dark:bg-background'
        icon={
          triggerDef.icon ? (
            <triggerDef.icon className='mt-0.5 mr-3.5 h-5 w-5 flex-shrink-0 text-[#611f69] dark:text-[#e01e5a]' />
          ) : null
        }
        title={`${triggerDef.provider.charAt(0).toUpperCase() + triggerDef.provider.slice(1)} Event Payload Example`}
      >
        Your workflow will receive a payload similar to this when a subscribed event occurs.
        <div className='overflow-wrap-anywhere mt-2 whitespace-normal break-normal font-mono text-sm'>
          <JSONView data={samplePayload} />
        </div>
      </Notice>
    </div>
  )
}
