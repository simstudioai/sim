import Image from 'next/image'
import { CalloutFrame } from '@/app/(landing)/components/features/components/callout-frame'

/**
 * The Integrate beat's callout - the REAL platform Integrations page as one
 * floating window: a full capture of the workspace UI (sidebar + Integrations
 * tab with the showcase mosaic, search, and Featured sections) taken by
 * `exports/readme-banner/capture-integrations-ui.mjs` at the hero shot's card
 * geometry (1280x735 @2x), framed by the shared {@link CalloutFrame} so it
 * wears the hero platform window's exact chrome (10px radius + layered
 * shadow).
 *
 * The window is oversized (125% of the media stage, ~82% of the capture's
 * native scale) and anchored with EQUAL top and left insets (96px), so its
 * top-left corner floats free over the backdrop while the right AND bottom
 * edges bleed past the media stage's clip - a zoomed-in peek at part of the
 * product rather than a complete miniature. Decorative.
 */
export function IntegrationsCallout() {
  return (
    <div className='absolute inset-0'>
      <CalloutFrame
        className='absolute top-[96px] left-[96px] w-[125%]'
        bodyClassName='aspect-[1280/735]'
      >
        <Image
          src='/landing/feature-integrate-ui.png'
          alt=''
          fill
          sizes='1050px'
          className='object-cover'
        />
      </CalloutFrame>
    </div>
  )
}
