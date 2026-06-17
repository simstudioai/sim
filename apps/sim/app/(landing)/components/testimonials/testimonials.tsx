import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'

/**
 * Landing testimonials — modeled on Linear's homepage: two large quote cards
 * side by side in a subtle two-tone (one `--surface-2`, one `--surface-6`),
 * each with a big quote and a company logo + attribution pinned to the bottom.
 * A muted line and a "Customer stories" link close the section.
 *
 * Quotes, names, and companies are PLACEHOLDERS — no real attributions — held
 * until real testimonials and company logos are sourced; the logo slot is a
 * neutral placeholder square sized for a real mark to drop in.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * horizontal padding (`px-12`) matches every section above, and the section is
 * capped and centered at the shared `max-w-[1446px]`.
 */

interface Quote {
  quote: string
  name: string
  role: string
  tone: 'plain' | 'tinted'
}

const QUOTES: Quote[] = [
  {
    quote:
      'The way we decide whether something actually ships is whether it runs in Sim. If an agent lives here, the whole team can see it, trust it, and improve it.',
    name: 'Placeholder Name',
    role: 'Head of Engineering, Company',
    tone: 'plain',
  },
  {
    quote:
      'We replaced a stack of brittle scripts with agents we can read. One workspace to build, deploy, and watch every run — we stopped stitching tools together and started shipping.',
    name: 'Placeholder Name',
    role: 'Head of Product, Company',
    tone: 'tinted',
  },
]

export function Testimonials() {
  return (
    <section
      id='testimonials'
      aria-labelledby='testimonials-heading'
      className='mx-auto w-full max-w-[1446px] px-12'
    >
      <h2 id='testimonials-heading' className='sr-only'>
        What teams say about Sim
      </h2>

      <ul className='grid grid-cols-2 gap-6'>
        {QUOTES.map(({ quote, name, role, tone }) => (
          <li
            key={role}
            className={cn(
              'flex min-h-[420px] flex-col justify-between gap-16 rounded-xl p-10',
              tone === 'tinted' ? 'bg-[var(--surface-6)]' : 'bg-[var(--surface-2)]',
              'border border-[var(--border-1)]'
            )}
          >
            <blockquote className='text-balance text-[26px] text-[var(--text-primary)] leading-[1.3]'>
              “{quote}”
            </blockquote>
            <div className='flex items-center gap-3'>
              <div
                aria-hidden='true'
                className='size-9 shrink-0 rounded-md bg-[var(--surface-7)]'
              />
              <div className='flex flex-col'>
                <span className='text-[14px] text-[var(--text-primary)]'>{name}</span>
                <span className='text-[13px] text-[var(--text-muted)]'>{role}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className='mt-8 flex items-center justify-between'>
        <p className='text-[15px] text-[var(--text-muted)]'>
          Trusted by teams shipping real work — from startups to the Fortune 500.
        </p>
        <Link
          href='/contact'
          className='text-[15px] text-[var(--text-primary)] transition-colors hover:text-[var(--text-body)]'
        >
          Customer stories →
        </Link>
      </div>
    </section>
  )
}
