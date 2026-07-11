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
 * native scale) and anchored with visually EQUAL top and left insets
 * (percentage-based - 9.6% of the stage width; 14.4% of its 3:2 height lands
 * at the same px), so its top-left corner floats free over the backdrop while
 * the right AND bottom edges bleed past the media stage's clip - a zoomed-in
 * peek at part of the product rather than a complete miniature, scaling
 * proportionally with the aspect-locked stage. Decorative.
 *
 * `sizes` mirrors the sibling backdrop image's own hint (`FeatureCard`'s
 * `70vw`/`900px` stage width), scaled by this callout's 125% overhang, with an
 * extra `max-width: 1023px` tier for `FeatureCard`'s `max-lg:grid-cols-1`
 * stack (media becomes ~full card width there, not the desktop 2-column
 * remainder) - verified against Lighthouse's measured mobile render width.
 */
export function IntegrationsCallout() {
  return (
    <div className='absolute inset-0'>
      <CalloutFrame
        className='absolute top-[14.4%] left-[9.6%] w-[125%]'
        bodyClassName='aspect-[1280/735]'
      >
        <Image
          src='/landing/feature-integrate-ui.png'
          alt=''
          fill
          sizes='(max-width: 1023px) 110vw, (max-width: 1460px) 87.5vw, 1125px'
          className='object-cover'
        />
      </CalloutFrame>
    </div>
  )
}
