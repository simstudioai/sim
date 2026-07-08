import { chipBorderShadowRing, cn } from '@sim/emcn'
import { TrustedBy } from '@/app/(landing)/components/trusted-by'
import { ContactForm } from '@/app/(landing)/contact/components/contact-form'

/**
 * Contact page — mirrors the demo page's two-column split: value proposition and
 * customer proof on the left, the message form in a content-height card on the
 * right.
 *
 * The section is a two-column CSS grid capped and centered at the shared
 * `max-w-[1460px]` with the navbar-aligned `px-20` gutter, so the headline starts
 * on the same vertical line as the wordmark. The desktop split is `xl:grid-cols-2`
 * with `xl:gap-x-0` — the columns split at the exact horizontal center, so the
 * right card occupies the same rectangle as the hero's right panel. The card is
 * inset from the section's top and bottom by 32px (`xl:pt-8`/`xl:pb-8`), spans both
 * rows (`xl:row-span-2`), and its content drives the column height — the left
 * column stretches to match, bottom-anchoring the logos to the card's lower edge.
 *
 * Three grid children, ordered in the DOM as headline → form → logos so the
 * COLLAPSE below `xl` (single column) yields the best mobile reading order: value
 * proposition first, the form immediately after it, then the customer logos as
 * reinforcing social proof. On desktop the headline cell adds `xl:pt-[80px]` so its
 * text sits on the hero's line, while the card top stays on the higher `top-8`
 * line. The customer proof reuses the shared {@link TrustedBy} block,
 * bottom-anchored (`xl:row-start-2 xl:self-end`). The gutter follows the navbar
 * convention (`px-20 max-lg:px-8 max-sm:px-5`), and `max-sm` drops to the smallest
 * type scale.
 *
 * Carries an sr-only product summary for AI citation (landing CLAUDE.md → GEO).
 */
export default function Contact() {
  return (
    <main id='main-content'>
      <section
        id='contact'
        aria-labelledby='contact-heading'
        className='mx-auto grid w-full max-w-[1460px] grid-cols-1 gap-y-10 px-20 pt-20 pb-24 max-sm:gap-y-8 max-sm:px-5 max-sm:pt-16 max-sm:pb-16 max-lg:px-8 xl:grid-cols-2 xl:grid-rows-[auto_1fr] xl:gap-x-0 xl:pt-8 xl:pb-8'
      >
        <div className='flex flex-col gap-5 xl:col-start-1 xl:row-start-1 xl:self-start xl:pt-[80px]'>
          <p className='sr-only'>
            Get in touch with Sim, the open-source AI workspace where teams build, deploy, and
            manage AI agents and workflows. Ask a question, request an integration, or get help from
            the team — send a message and we'll get back to you shortly.
          </p>

          <h1
            id='contact-heading'
            className='text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-wrap max-xl:text-[40px] [&>br]:max-xl:hidden'
          >
            Get in touch with Sim, <br />
            the AI agent workspace.
          </h1>
          <p className='max-w-[46ch] text-pretty text-[var(--text-body)] text-lg leading-[1.5] max-sm:text-base'>
            Ask a question, request an integration, or get help from the team. Tell us what you need
            and we'll get back to you shortly.
          </p>
        </div>

        <div
          className={cn(
            'relative min-w-0 overflow-hidden rounded-lg bg-[var(--surface-2)]',
            chipBorderShadowRing,
            'xl:col-start-2 xl:row-span-2 xl:row-start-1'
          )}
        >
          <div className='p-6 max-sm:p-5'>
            <ContactForm />
          </div>
        </div>

        <TrustedBy className='xl:col-start-1 xl:row-start-2 xl:self-end' />
      </section>
    </main>
  )
}
