import Image from 'next/image'

/**
 * Full-bleed illustration pinned behind the footer via CSS `position: sticky`.
 * Scrolling past the footer's natural end uncovers it for a 320px (200px on
 * mobile) reveal window — a "peel" effect with zero JS (no scroll listeners,
 * no animation library). Ported from the main app's landing footer
 * (`apps/sim/app/(landing)/components/footer/components/footer-peel`) so the
 * two sites match exactly. The `Footer` component that renders this
 * (`./footer.tsx`) reserves that same extra scroll room as bottom padding,
 * and pulls its own opaque content up over this element with a matching
 * negative margin, so the illustration stays fully hidden until the footer
 * content has scrolled away. The height values here (`320px`/`200px`) must
 * stay in sync with the ones hardcoded in `footer.tsx` — Tailwind can't share
 * an arbitrary-value size across a JS constant, so this is a literal-class
 * pairing, not a shared source of truth.
 */
export function FooterPeel() {
  return (
    <div
      className='-z-10 sticky bottom-0 h-[320px] w-full overflow-hidden max-sm:h-[200px]'
      aria-hidden='true'
    >
      <div className='relative h-full w-full'>
        <Image
          src='/static/landing/footer-peel.jpg'
          alt=''
          fill
          sizes='100vw'
          className='object-cover object-[center_38%]'
        />
      </div>
    </div>
  )
}
