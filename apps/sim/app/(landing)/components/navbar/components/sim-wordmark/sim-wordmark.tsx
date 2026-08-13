import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@/lib/branding/wordmark'

/**
 * Inline "sim" brand logotype (wordmark, no separate icon mark) - the paths
 * from the v1.0 brand guide's `simLogotype--dark.svg`, inlined so the logo
 * ships as zero-request server-rendered HTML. They live in
 * `@/lib/branding/wordmark` because the email header rasterizes the same
 * outlines.
 *
 * Filled with a single solid `var(--text-body)` - the navbar's own text color
 * (the same token its nav-link chips use) - so the wordmark reads as one solid
 * ink that matches the surrounding nav text, with no gradient or glow.
 *
 * Drawn at 18px tall - the chip's 14px label plus 2px above/below; the parent
 * slot centers it in a chip-height (30px) box. Nudged up 1.5px: the glyph mass
 * sits below the i-dot's headroom, so true geometric centering reads low.
 */
export function SimWordmark() {
  return (
    <svg
      viewBox={`0 0 ${WORDMARK_VIEW_BOX.width} ${WORDMARK_VIEW_BOX.height}`}
      width={37}
      height={18}
      fill='none'
      aria-hidden='true'
      className='-translate-y-[1.5px] h-[18px] w-auto'
    >
      <g fill='var(--text-body)'>
        {WORDMARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}
