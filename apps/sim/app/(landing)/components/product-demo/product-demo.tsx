import { cn } from '@sim/emcn'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_STAGE_RADIUS,
} from '@/app/(landing)/components/landing-layout'
import {
  ProductDemoBeatProvider,
  ProductDemoCaption,
} from '@/app/(landing)/components/product-demo/components/product-demo-caption'
import { ProductDemoVisualMount } from '@/app/(landing)/components/product-demo/components/product-demo-visual-mount'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { SIGNUP_HREF } from '@/app/(landing)/constants'

/**
 * The product demo as a player: a framed stage on the page ground, on the
 * platform cards' inset ({@link HOME_INSET}) inside the content column so it
 * lines up with the two cards it follows, on the `#F8F8F8` paper Andrew set
 * for it (no greyscale token lands on it) with a hairline and the stage
 * radius. From `lg` the frame holds a 2:1 aspect and its width is also
 * capped by the screen's height, so the whole frame - scene and caption -
 * fits below the sticky navbar with air above and below, and nothing inside
 * can change its size: the scene runs like a video. Below `lg` the frame is
 * content-sized, the stage over the caption.
 *
 * The caption ({@link ProductDemoCaption}) is the section's heading, overlaid
 * top-centre from `lg` (72px in, so it is not pressed to the edge) and above
 * the stage in flow below it, and it follows the scene: one title per act,
 * crossfading as its act begins. The shared secondary outline pill, "Start
 * building with Sim", mirrors it at the bottom centre with the same inset
 * and the landing's animated chevron. The title is the `#3B3B3B`
 * Andrew set for this ground. The stage itself
 * is transparent, so the white composer and the workflow cards float straight
 * on the paper.
 *
 * The stage's four edges blur and fade into the paper through the shared
 * {@link EdgeFade} - the same progressive ramp the features rail wears, so a
 * card the scene carries to an edge softens away instead of being cut. Over
 * it, {@link CopyBands} adds the two strong bands the player needs and the
 * shared strips do not carry: one under the overlaid title and one under the
 * link, so the copy stays legible with the scene running beneath it.
 *
 * The stage carries the gooey composer loop - a prompt is typed and sent, the
 * reply box goo-morphs out of the composer, Sim thinks and streams a reply,
 * and the workflow builds - lazy-mounted via {@link ProductDemoVisualMount}
 * so its bundle and timers only load once this below-the-fold section nears
 * the viewport. The mount measures how far the overlaid caption reaches into
 * the stage and hands that clearance to the loop, which keeps the scene
 * centred in the frame yet clear of the copy, and it relays the loop's beats
 * to the caption through {@link ProductDemoBeatProvider}.
 */

/** The paper ground, the one literal on this page, paired with its dark value. */
const PAPER = 'bg-[#F8F8F8] dark:bg-[var(--surface-2)]'

/**
 * From `lg` the frame is a player: a 2:1 aspect, a step shorter than the
 * hero's 1648/898 stage so the section does not tower, and a width cap that
 * keeps its height inside the screen below the 88px navbar with 40px of air
 * above and below, so scrolling the section up under the navbar shows the
 * whole frame at once. The cap's multiplier is the aspect.
 */
const FRAME_PLAYER = 'lg:aspect-[2/1] lg:max-w-[calc((100svh-168px)*2)]'

/**
 * From `lg` the title sits this far inside the frame's top edge and the link
 * the same distance inside its bottom edge - a share of the frame's height,
 * so both keep their distance from the edges and from the scene whatever the
 * screen makes of the frame (107px on the 824px frame at the content cap,
 * 82px on the 632px frame an 800px-tall screen allows). Below `lg` both are
 * in flow with their own padding. The copy bands ({@link CopyBands}) are
 * built on the same 13%.
 */
const TITLE_INSET = 'lg:top-[13%]'
const LINK_INSET = 'lg:bottom-[13%]'

const EDGE_STRIP =
  'pointer-events-none absolute z-[5] [--paper:#F8F8F8] dark:[--paper:var(--surface-2)]'

/**
 * The strong bands, and the reason this file still draws bands of its own: the
 * shared {@link EdgeFade} softens the scene into the ground at every edge, but
 * it is deliberately even all the way along an edge, and the player overlays
 * copy on two of them. From `lg` each band runs the copy's 13% inset plus 80px
 * down from the top (the title) or up from the bottom (the link), solid at
 * 8px of blur through the copy (its inset plus 40px) and tapering over the
 * last 40px, and a second mask fades it out sideways, so it covers the centre
 * where the title and the link sit and leaves the corners to the shared strip
 * - a card passing a corner is not blurred for no reason. The bands end where
 * the scene begins ({@link ProductDemoVisualMount} keeps the scene 81px under
 * the copy's inset), so the composer never sits in the taper.
 */
const COPY_BAND =
  'inset-x-0 h-[96px] lg:h-[calc(13%+80px)] [mask-image:linear-gradient(to_right,transparent_15%,black_34%,black_66%,transparent_85%)]'
const COPY_BLUR = 'absolute inset-0 backdrop-blur-[8px]'
const COPY_TOP_MASK = '[mask-image:linear-gradient(to_bottom,black_calc(100%-40px),transparent)]'
const COPY_BOTTOM_MASK = '[mask-image:linear-gradient(to_top,black_calc(100%-40px),transparent)]'

/**
 * The two blurred bands that sit under the player's overlaid copy, above the
 * scene and below the copy itself. The `--paper` they dissolve into is the
 * frame's own ground.
 */
function CopyBands() {
  return (
    <>
      <div data-copy-band='top' className={cn(EDGE_STRIP, COPY_BAND, 'top-0')}>
        <div
          className={cn(
            COPY_BLUR,
            COPY_TOP_MASK,
            'bg-gradient-to-b from-[var(--paper)] to-transparent'
          )}
        />
      </div>
      <div data-copy-band='bottom' className={cn(EDGE_STRIP, COPY_BAND, 'bottom-0')}>
        <div
          className={cn(
            COPY_BLUR,
            COPY_BOTTOM_MASK,
            'bg-gradient-to-t from-[var(--paper)] to-transparent'
          )}
        />
      </div>
    </>
  )
}

export function ProductDemo() {
  return (
    <section id='product-demo' aria-labelledby='product-demo-heading' className='w-full'>
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div className={HOME_INSET}>
          <ProductDemoBeatProvider>
            <div
              className={cn(
                'relative mx-auto flex w-full flex-col overflow-hidden border border-[var(--border)]',
                PAPER,
                LANDING_STAGE_RADIUS,
                FRAME_PLAYER
              )}
            >
              <ProductDemoCaption
                className={cn('px-6 pt-10 pb-6 lg:absolute lg:inset-x-0 lg:p-0', TITLE_INSET)}
              />

              {/* The scene is a picture, not a control: nothing in it takes the pointer. */}
              <div
                aria-hidden='true'
                inert
                className='pointer-events-none relative min-h-[300px] w-full flex-1 select-none overflow-hidden lg:absolute lg:inset-0 lg:min-h-0'
              >
                <ProductDemoVisualMount />
                <EdgeFade ground='paper' />
                <CopyBands />
              </div>

              <div
                className={cn(
                  'relative z-10 mx-auto w-fit pt-4 pb-10 lg:absolute lg:inset-x-0 lg:p-0',
                  LINK_INSET
                )}
              >
                <LandingCtaLink variant='outline' href={SIGNUP_HREF} prefetch={false} withArrow>
                  Start building with Sim
                </LandingCtaLink>
              </div>
            </div>
          </ProductDemoBeatProvider>
        </div>
      </div>
    </section>
  )
}
