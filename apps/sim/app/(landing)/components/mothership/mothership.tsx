import { ThinkingLoader, type ThinkingLoaderVariant } from '@/components/emcn'

/**
 * Landing Mothership section — the brand-world register of the page, and the
 * "how Sim works" explainer. The Mothership (the Core) leads the section: its
 * cycle-loader shape sits with the title. Below, the rest of the lexicon
 * (Pod · Formation · Dispatch · Return) runs as columns, each paired with its
 * tied loader shape (the same shapes the product uses) and copy that ties the
 * term to a real platform capability — a cascade of how the work flows out and
 * comes back.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. Horizontal padding (`px-12`) matches
 * the sections above, and the section is capped at the shared `max-w-[1446px]`.
 */

interface Term {
  word: string
  /** Cycle-loader shape tied to this term (matches the product's loader canon). */
  variant: ThinkingLoaderVariant
  definition: string
}

const LEXICON: Term[] = [
  {
    word: 'Pod',
    variant: 'squeeze',
    definition: 'One agent for one job, with any model and 1,000+ integrations.',
  },
  {
    word: 'Formation',
    variant: 'compass',
    definition: 'Many agents on one problem — run in parallel, merged into one.',
  },
  {
    word: 'Dispatch',
    variant: 'metaballs',
    definition: 'Ship to production as an API, a Slack bot, or a scheduled run.',
  },
  {
    word: 'Return',
    variant: 'relay',
    definition: 'Every run comes back with a full trace, logs, and real cost.',
  },
]

export function Mothership() {
  return (
    <section
      id='mothership'
      aria-labelledby='mothership-heading'
      className='mx-auto w-full max-w-[1446px] px-12'
    >
      {/* The Mothership's own shape leads the section — it's the Core, so its
          loader sits with the title rather than as one of the columns. */}
      <ThinkingLoader variant='corners' size={48} className='mb-7' />
      <h2 id='mothership-heading' className='max-w-[1200px] text-balance text-[28px] leading-[1.3]'>
        <span className='block text-[var(--text-body)]'>Mothership. Agents at your command.</span>
        <span className='block text-[var(--text-subtle)]'>
          Your AI workspace for building agentic workflows.
        </span>
      </h2>

      <ul className='mt-16 grid grid-cols-4 gap-8'>
        {LEXICON.map(({ word, variant, definition }) => (
          <li key={word} className='flex flex-col gap-5'>
            <ThinkingLoader variant={variant} size={44} />
            <div className='flex flex-col gap-2'>
              <h3 className='text-[17px] text-[var(--text-primary)]'>{word}</h3>
              <p className='text-pretty text-[14px] text-[var(--text-body)] leading-[1.5]'>
                {definition}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
