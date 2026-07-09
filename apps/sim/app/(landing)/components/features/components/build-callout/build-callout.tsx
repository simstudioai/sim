import { ThinkingLoader } from '@/components/ui'
import { WorkflowShowcase } from '@/app/(landing)/components/features/components/build-callout/components/workflow-showcase'

/**
 * The Build beat's callout - the finished workflow canvas centered on the
 * card's solid grey stage, with the goo cycle loader phasing through its
 * world-state phrases in the bottom-left corner. The Mothership chat loop
 * (`components/build-chat-animation`) is parked here unwired, kept for reuse
 * on another surface.
 */
export function BuildCallout() {
  return (
    <div aria-hidden='true' className='pointer-events-none absolute inset-0'>
      <WorkflowShowcase />
      <div className='absolute bottom-8 left-8 max-sm:bottom-4 max-sm:left-4'>
        <ThinkingLoader size={22} phase className='text-[var(--text-body)]' />
      </div>
    </div>
  )
}
