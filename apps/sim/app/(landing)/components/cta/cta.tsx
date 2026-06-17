import Image from 'next/image'
import { ChipLink } from '@/components/emcn'

/**
 * Landing pre-footer CTA — the page's final conversion band, set over the
 * Mothership Object (the brand's hero render) as a decorative backdrop. The
 * headline and the two primary actions (matching the hero's CTA pair) sit
 * centered over the ship; the render fades into the page background at its foot
 * so the footer emerges with no hard edge between the two.
 *
 * The section is a relative positioning context: a soft tonal radial halo sits
 * behind the matte-white hull so it reads on the white page, the ship sits in
 * normal flow (so its aspect ratio sets the band's height), and a foot fade
 * blends it into `--bg`. The CTA content is absolutely centered over the whole
 * stack.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * horizontal padding (`px-12`) matches every section above, and the section is
 * capped and centered at the shared `max-w-[1446px]`.
 */
export function Cta() {
  return (
    <section
      id='cta'
      aria-labelledby='cta-heading'
      className='relative mx-auto w-full max-w-[1446px] px-12'
    >
      {/* The Mothership, rendered — the brand's hero Object, now the backdrop
          for the final CTA. Decorative. */}
      {/* Soft tonal Field behind the matte-white hull so it reads on the white
          page — a radial halo that fades to transparent at the edges (no hard
          band), keeping the ship floating rather than boxed. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(68%_72%_at_50%_42%,var(--surface-6),transparent_70%)]'
      />
      <Image
        src='/landing/sim-mothership.webp'
        alt=''
        aria-hidden='true'
        width={2496}
        height={1172}
        sizes='100vw'
        // Pre-optimized transparent WebP (87KB); served as-is so it doesn't
        // depend on the image optimizer (which rejects this asset in dev).
        unoptimized
        className='relative h-auto w-full'
      />
      {/* Fade the foot into the page background so the footer emerges with no
          hard edge. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[var(--bg)] to-transparent'
      />

      {/* CTA content, centered over the backdrop. */}
      <div className='absolute inset-0 flex flex-col items-center justify-center gap-8 px-12 text-center'>
        <h2
          id='cta-heading'
          className='max-w-[720px] text-balance text-[40px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em]'
        >
          Build your first agent today.
        </h2>
        <div className='flex items-center gap-2'>
          <ChipLink variant='primary' href='/signup'>
            Get started
          </ChipLink>
          <ChipLink href='/contact' className='border border-[var(--border-1)]'>
            Contact sales
          </ChipLink>
        </div>
      </div>
    </section>
  )
}
