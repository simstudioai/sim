import { TrustedBy } from '@/app/(landing)/components/trusted-by'
import { DemoBooking } from '@/app/(landing)/demo/components/demo-booking'

/**
 * Book-a-demo page - mirrors the hero's two-column split, but with in-flow
 * content (not absolute panels) and a content-height right card.
 *
 * The section is a two-column CSS grid capped and centered at the shared
 * `max-w-[1446px]` with the navbar-aligned `px-12` gutter, so the headline starts
 * on the same vertical line as the wordmark. The desktop split is
 * `xl:grid-cols-2` with `xl:gap-x-0` - the columns split at the exact horizontal
 * center, so the right booking card occupies the same rectangle as the hero's
 * right visual panel: its left edge on the center line, its right edge on the
 * `px-12` gutter. The card is also inset from the section's top and bottom by 32px
 * (`xl:pt-8`/`xl:pb-8`), matching the hero panel's `top-8`/`bottom-8`. The booking
 * card spans both rows (`xl:row-span-2`) and its content drives the column
 * height - the left column stretches to match, so the logos bottom-anchor to the
 * card's lower edge. There is no fixed viewport height, so the card never clips
 * and sits at its natural height, level with the hero card.
 *
 * Three grid children, ordered in the DOM as headline → booking → logos so the
 * COLLAPSE below `xl` (single column) yields the best mobile reading order:
 * value proposition first, the conversion card immediately after it, then the
 * customer logos as reinforcing social proof. On desktop the headline cell adds
 * `xl:pt-[80px]` so its text sits on the hero's `pt-[112px]` line (32px section
 * inset + 80px), while the booking card top stays on the higher `top-8` line -
 * just like the hero, whose visual panel rises above the headline. The customer
 * proof reuses the shared {@link TrustedBy} block (the same label + logo grid the
 * hero uses), bottom-anchored (`xl:row-start-2 xl:self-end`) so it rests on the
 * card's lower edge. Below `xl` it stacks; the gutter follows the navbar
 * convention (`px-12 max-lg:px-8 max-sm:px-5`) so the headline stays on the
 * wordmark line, and `max-sm` drops to the smallest type scale.
 *
 * Carries an sr-only product summary for AI citation (landing CLAUDE.md → GEO).
 */
export default function Demo() {
  return (
    <main id='main-content'>
      <section
        id='demo'
        aria-labelledby='demo-heading'
        className='mx-auto grid w-full max-w-[1446px] grid-cols-1 gap-y-10 px-12 pt-20 pb-24 max-sm:gap-y-8 max-sm:px-5 max-sm:pt-16 max-sm:pb-16 max-lg:px-8 xl:grid-cols-2 xl:grid-rows-[auto_1fr] xl:gap-x-0 xl:pt-8 xl:pb-8'
      >
        <div className='flex flex-col gap-5 xl:col-start-1 xl:row-start-1 xl:self-start xl:pt-[80px]'>
          <p className='sr-only'>
            Operationalize AI with Sim, the AI agent workspace where teams build, deploy, and manage
            AI agents and workflows. A Sim specialist walks your team through building agents that
            automate real work across 1,000+ integrations and every major LLM, visually,
            conversationally, or with code.
          </p>

          <h1
            id='demo-heading'
            className='text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-wrap max-xl:text-[40px] [&>br]:max-xl:hidden'
          >
            Operationalize AI with Sim, <br />
            the AI agent workspace.
          </h1>
          <p className='max-w-[46ch] text-pretty text-[var(--text-body)] text-lg leading-[1.5] max-sm:text-base'>
            Tell us what you're working on and we'll show you how teams use Sim to build, deploy,
            and manage AI agents and workflows visually, conversationally, or with code.
          </p>
        </div>

        <DemoBooking className='xl:col-start-2 xl:row-span-2 xl:row-start-1' />

        <TrustedBy className='xl:col-start-1 xl:row-start-2 xl:self-end' />
      </section>
    </main>
  )
}
