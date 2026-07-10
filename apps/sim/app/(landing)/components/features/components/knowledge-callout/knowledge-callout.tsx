import Image from 'next/image'
import { CalloutFrame } from '@/app/(landing)/components/features/components/callout-frame'

/**
 * The Context beat's callout - the REAL platform Knowledge base page as one
 * floating window: a full capture of the workspace UI (sidebar with Knowledge
 * base selected + the knowledge list) taken by
 * `exports/readme-banner/capture-knowledge-ui.mjs` at the hero shot's card
 * geometry (1280x735 @2x), framed by the shared {@link CalloutFrame} so it
 * wears the hero platform window's exact chrome (10px radius + layered
 * shadow).
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
        <Image
          src='/landing/feature-context-ui.png'
          alt=''
          fill
          sizes='1050px'
          className='object-cover'
        />
      </CalloutFrame>
    </div>
  )
}
