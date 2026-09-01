import { CalloutFrame } from '@/app/(landing)/components/features/components/callout-frame'
import { CapturedPlatformSurface } from '@/app/(landing)/components/features/components/captured-platform-surface'

/**
 * The Context beat's callout - the platform Knowledge bases page as one
 * floating window. The detailed page capture is paired with the shared live
 * landing sidebar so its navigation and footer stay aligned with the product.
 *
 * Same oversized treatment as the Integrate card: 125% of the media stage
 * with EQUAL top and left insets (96px), so the top-left corner floats free
 * over the backdrop while the right and bottom edges bleed past the media
 * stage's clip. Decorative.
 */
export function KnowledgeCallout() {
  return (
    <div className='absolute inset-0'>
      <CalloutFrame
        className='absolute top-[14.4%] left-[9.6%] w-[125%]'
        bodyClassName='aspect-[1280/735]'
      >
        <CapturedPlatformSurface
          src='/landing/feature-context-ui.png'
          sizes='1050px'
          activeItem='Knowledge bases'
        />
      </CalloutFrame>
    </div>
  )
}
