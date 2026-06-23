import type { ComponentType } from 'react'
import {
  IsoBuildIllustration,
  IsoIngestIllustration,
  IsoIntegrateIllustration,
  IsoMonitorIllustration,
} from '@/app/(landing)/components/mothership/components/iso-marks'

/**
 * Landing Sim section — the high-level "how Sim works" overview that sets up the
 * {@link Features} deep-dive. A two-line heading frames Sim as one workspace for
 * the whole platform; below, four columns call out its main areas (Integrate ·
 * Ingest context · Build · Monitor), each paired with an abstract circle "goo"
 * mark and a one-line definition. These are the same four areas Features then
 * shows in real product UI — framed here in fewer words, from the "what it is"
 * angle, so the overview and the deep-dive don't repeat each other.
 *
 * The marks are the only client islands in this section — interactive brand
 * glyphs (subtle hover breathe/rotate); the section itself stays server-rendered.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. Horizontal padding (`px-12`) matches
 * the sections above, and the section is capped at the shared `max-w-[1446px]`.
 */

type GooMark = ComponentType<{ size?: number; className?: string }>

interface Area {
  word: string
  /** Abstract circle goo-mark paired with the area. */
  Mark: GooMark
  /**
   * Per-mark render size, tuned so the collection reads as one optical weight.
   * The marks have different shape ratios (a full cube vs a flat lattice), so a
   * uniform size makes some look bigger; these equalize their visual footprint.
   */
  size: number
  definition: string
}

const AREAS: Area[] = [
  {
    word: 'Integrate',
    Mark: IsoIntegrateIllustration,
    size: 156,
    definition: 'One catalog of 1,000+ connectors your agents reach out and act through.',
  },
  {
    word: 'Ingest context',
    Mark: IsoIngestIllustration,
    size: 156,
    definition: 'Your data, stored semantically — the memory agents reason over.',
  },
  {
    word: 'Build',
    Mark: IsoBuildIllustration,
    size: 166,
    definition: 'Compose agent logic on a canvas, or just describe it to Sim.',
  },
  {
    word: 'Monitor',
    Mark: IsoMonitorIllustration,
    size: 166,
    definition: 'See inside every run — traces, logs, and real cost, live.',
  },
]

export function Mothership() {
  return (
    <section
      id='mothership'
      aria-labelledby='mothership-heading'
      className='mx-auto w-full max-w-[1446px] px-12 max-sm:px-5 max-lg:px-8'
    >
      <h2
        id='mothership-heading'
        className='max-w-[1200px] text-balance text-[28px] leading-[1.3] max-sm:text-[22px]'
      >
        <span className='block text-[var(--text-body)]'>
          Everything your agents need, in one workspace.
        </span>
        <span className='block text-[var(--text-subtle)]'>Build, run, and watch every agent.</span>
      </h2>

      <ul className='mt-16 grid grid-cols-4 gap-8 max-sm:grid-cols-1 max-sm:gap-10 max-lg:mt-12 max-lg:grid-cols-2 max-lg:gap-x-8 max-lg:gap-y-12'>
        {AREAS.map(({ word, Mark, size, definition }) => (
          <li key={word} className='flex flex-col gap-7 max-sm:gap-5'>
            <div className='flex size-[148px] items-center justify-center'>
              <Mark size={size} />
            </div>
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
