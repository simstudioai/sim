import {
  LineGlyph,
  type LineGlyphVariant,
} from '@/app/(landing)/components/mothership/components/line-glyph/line-glyph'

/**
 * Landing Sim section — the high-level "how Sim works" overview that sets up the
 * {@link Features} deep-dive. A two-line heading frames Sim as one workspace for
 * the whole platform; below, four columns call out its main areas (Integrate ·
 * Ingest context · Build · Monitor), each paired with an abstract loader glyph
 * and a one-line definition. These are the same four areas Features then shows in
 * real product UI — framed here in fewer words, from the "what it is" angle, so
 * the overview and the deep-dive don't repeat each other.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. Horizontal padding (`px-12`) matches
 * the sections above, and the section is capped at the shared `max-w-[1446px]`.
 */

interface Area {
  word: string
  /** Abstract line-geometry glyph paired with the area. */
  glyph: LineGlyphVariant
  definition: string
}

const AREAS: Area[] = [
  {
    word: 'Integrate',
    glyph: 'spirograph',
    definition: 'One catalog of 1,000+ connectors your agents reach out and act through.',
  },
  {
    word: 'Ingest context',
    glyph: 'flower',
    definition: 'Your data, stored semantically — the memory agents reason over.',
  },
  {
    word: 'Build',
    glyph: 'lissajous-3-2',
    definition: 'Compose agent logic on a canvas, or just describe it to Sim.',
  },
  {
    word: 'Monitor',
    glyph: 'lissajous-5-4',
    definition: 'See inside every run — traces, logs, and real cost, live.',
  },
]

export function Mothership() {
  return (
    <section
      id='mothership'
      aria-labelledby='mothership-heading'
      className='mx-auto w-full max-w-[1446px] px-12'
    >
      <h2 id='mothership-heading' className='max-w-[1200px] text-balance text-[28px] leading-[1.3]'>
        <span className='block text-[var(--text-body)]'>
          Everything your agents need, in one workspace.
        </span>
        <span className='block text-[var(--text-subtle)]'>
          Build, run, and watch every agent.
        </span>
      </h2>

      <ul className='mt-16 grid grid-cols-4 gap-8'>
        {AREAS.map(({ word, glyph, definition }) => (
          <li key={word} className='flex flex-col gap-7'>
            <LineGlyph variant={glyph} size={168} />
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
