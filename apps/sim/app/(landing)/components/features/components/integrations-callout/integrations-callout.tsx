import { CalloutFrame } from '@/app/(landing)/components/features/components/callout-frame'
import { CapturedPlatformSurface } from '@/app/(landing)/components/features/components/captured-platform-surface'

/**
 * The Integrate beat's callout - the platform Integrations page as one
 * floating window. The detailed page capture is paired with the shared live
 * landing sidebar so its navigation and footer stay aligned with the product.
 *
 * The window is oversized (125% of the media stage, ~82% of the capture's
 * native scale) and anchored with visually EQUAL top and left insets
 * (percentage-based - 9.6% of the stage width; 14.4% of its 3:2 height lands
 * at the same px), so its top-left corner floats free over the backdrop while
 * the right AND bottom edges bleed past the media stage's clip - a zoomed-in
 * peek at part of the product rather than a complete miniature, scaling
 * proportionally with the aspect-locked stage. Decorative.
 *
 * `sizes` is derived directly from the section's grid math rather than
 * approximated, then rounded up to the worst-case (peak render/viewport
 * ratio) in each tier so the browser never under-fetches:
 * `callout = 1.25 * (viewport - 2*gutter - 32px card padding - [40px gap +
 * 386px fixed copy column, desktop only])`, gutter = `px-20`/`max-lg:px-8`/
 * `max-sm:px-5` from `Features`'s grid, matching `FeatureCard`'s
 * `max-lg:grid-cols-1` stack. Peak ratios (verified against a static
 * reproduction of this exact layout rendered at each Tailwind breakpoint):
 * ~113.3% at the `max-width: 1023px` stacked tier's own upper edge, ~108.6%
 * at `1460px` (the container's cap, where render width stops growing with
 * viewport - hence the final tier is a flat px value, not a vw fraction).
 */
export function IntegrationsCallout() {
  return (
    <div className='absolute inset-0'>
      <CalloutFrame
        className='absolute top-[14.4%] left-[9.6%] w-[125%]'
        bodyClassName='aspect-[1280/735]'
      >
        <CapturedPlatformSurface
          src='/landing/feature-integrate-ui.png'
          sizes='(max-width: 1023px) 114vw, (max-width: 1460px) 109vw, 1053px'
          activeItem='Integrations'
        />
      </CalloutFrame>
    </div>
  )
}
