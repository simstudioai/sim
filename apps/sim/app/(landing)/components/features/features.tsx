import { ChipLink } from '@/components/emcn'

/**
 * Landing features — a two-column header row above a full-width platform preview.
 *
 * The header pairs a vision headline with a concrete proof: the section `<h2>`
 * on the left in the headline color (`--text-primary`, matching the hero's
 * `<h1>`) at 32px, and a supporting description on the right matching the hero
 * description's scale and color (`text-[20px]` / `--text-body`) with a primary
 * CTA chip beneath it. `grid-cols-2` splits them at the horizontal midline and
 * `items-start` top-aligns the headline with the description.
 *
 * Below the header sits a full-width platform-preview panel — a placeholder for
 * the product UI — carrying the same chrome as the hero's visual panel
 * (`--surface-2` fill, `--border-1` hairline, `rounded-lg`, `overflow-hidden`)
 * so the two read as one elevated surface family. Its `h-[720px]` reserves a
 * fixed footprint, keeping CLS at zero.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. Horizontal padding (`px-16`) matches
 * the navbar and hero, so the headline starts on the wordmark's line.
 */
export function Features() {
  return (
    <section id='features' aria-labelledby='features-heading' className='px-16'>
      <div className='grid grid-cols-2 items-start gap-16'>
        <h2
          id='features-heading'
          className='text-balance text-[32px] text-[var(--text-primary)] leading-[1.3]'
        >
          Not a tool you visit. A workspace you live in.
        </h2>

        <div className='flex flex-col items-start gap-8'>
          <p className='text-balance text-[20px] text-[var(--text-body)] leading-[1.5]'>
            Build a Slack bot, a compliance reviewer, or a data pipeline — then deploy and run it
            without leaving Sim. 1,000+ integrations and every major LLM, in one place.
          </p>
          <ChipLink variant='primary' href='/signup'>
            Get started
          </ChipLink>
        </div>
      </div>

      <div className='mt-[120px] h-[720px] w-full overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)]' />
    </section>
  )
}
