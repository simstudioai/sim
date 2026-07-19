import { LoaderMarks } from '@/app/(landing)/components/product-demo/components/loader-marks'
import { ProductDemoVisualMount } from '@/app/(landing)/components/product-demo/components/product-demo-visual-mount'

/**
 * Product-demo band - the looping animated platform walkthrough, promoted out of
 * the hero into its own section between the hero and the Mothership section,
 * dressed in the same card chrome as the {@link Features} cards: one large
 * OUTLINED container (`--border` hairline, 10px radius, 1rem padding) holding
 * the media stage on the left - here the animation itself fills the stage
 * (4px inner radius, solid light-grey `--surface-5` ground) instead of a
 * backdrop + floating callout - and a vertically-centered title + subtitle in the cards' 386px
 * copy column on the right. Below `lg` it stacks media-over-copy like the
 * cards do.
 *
 * The visual is the same `HeroVisual` client island the hero used to host
 * (decorative, `aria-hidden`), lazy-mounted via {@link ProductDemoVisualMount}
 * so its bundle and animation loop only load once this below-the-fold section
 * nears the viewport. The section carries the shared
 * `px-20 max-lg:px-8 max-sm:px-5` gutter and the `max-w-[1460px]` cap so the
 * card aligns with the hero's media frame above and the feature cards below.
 */
export function ProductDemo() {
  return (
    <section
      id='product-demo'
      aria-labelledby='product-demo-heading'
      className='mx-auto w-full max-w-[1460px] px-20 max-sm:px-5 max-lg:px-8'
    >
      <div className='grid grid-cols-[1fr_386px] gap-10 rounded-[10px] border border-[var(--border)] p-4 max-lg:grid-cols-1 max-lg:gap-6'>
        <div
          aria-hidden='true'
          className='relative h-[650px] overflow-hidden rounded-[4px] bg-[var(--surface-5)] max-sm:h-[280px] max-lg:h-[360px]'
        >
          <ProductDemoVisualMount />
        </div>

        <div className='flex flex-col justify-center pr-4 max-lg:pr-0 max-lg:pb-2'>
          <div className='mb-8'>
            <LoaderMarks />
          </div>
          <h2
            id='product-demo-heading'
            className='text-balance font-medium text-[22px] text-[var(--text-primary)] leading-[1.3] max-sm:text-[20px]'
          >
            Describe it. Sim builds it.
          </h2>
          <p className='mt-3 text-pretty text-[15px] text-[var(--text-muted)] leading-[1.6]'>
            Tell Sim what you need in plain English and it wires blocks, models, and integrations
            into a working agent.
          </p>
        </div>
      </div>
    </section>
  )
}
