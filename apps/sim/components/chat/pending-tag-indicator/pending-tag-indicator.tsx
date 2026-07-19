import { ThinkingLoader } from '@/components/ui'

/**
 * The "still working" affordance shown while a turn is between visible output —
 * mid-stream with nothing yet painted, or while a special tag is still
 * arriving and cannot be drawn until it closes.
 *
 * Lives beside the renderers rather than inside the special-tag components
 * because every chat surface shows it, including ones that draw no special
 * tags at all.
 */
export function PendingTagIndicator() {
  return (
    <div className='animate-stream-fade-in py-2'>
      <ThinkingLoader size={20} startVariant='corners' label='Thinking…' labelRatio={0.7} />
    </div>
  )
}
