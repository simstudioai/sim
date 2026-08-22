/**
 * The "sim" logotype paths from the v1.0 brand guide (`simLogotype--dark.svg`).
 *
 * Shared so the surfaces that draw the mark cannot drift: `SimWordmark` inlines
 * them as server-rendered SVG for the navbar, footer, auth shell and settings
 * sidebar. The email header cannot — clients (Gmail chief among them) strip
 * inline SVG — so it renders a committed raster export of these same outlines;
 * {@link EMAIL_WORDMARK_SIZE} records how that file is produced.
 */
export const WORDMARK_VIEW_BOX = { width: 441, height: 212 } as const

/** Glyph outlines, drawn in `WORDMARK_VIEW_BOX` coordinates. */
export const WORDMARK_PATHS: readonly string[] = [
  'M0 160.9H29.51C29.51 169.08 32.46 175.61 38.37 180.48C44.27 185.12 52.25 187.44 62.31 187.44C73.24 187.44 81.65 185.34 87.56 181.14C93.46 176.71 96.41 170.85 96.41 163.55C96.41 158.24 94.77 153.82 91.49 150.28C88.43 146.74 82.75 143.86 74.44 141.65L46.24 135.01C32.03 131.47 21.42 126.05 14.43 118.75C7.65 111.45 4.26 101.83 4.26 89.88C4.26 79.93 6.78 71.3 11.81 64C17.05 56.7 24.16 51.06 33.12 47.08C42.3 43.09 52.8 41.1 64.6 41.1C76.41 41.1 86.57 43.2 95.1 47.41C103.84 51.61 110.62 57.47 115.43 64.99C120.46 72.52 123.08 81.48 123.3 91.87H93.79C93.57 83.47 90.84 76.94 85.59 72.3C80.34 67.65 73.02 65.33 63.62 65.33C54 65.33 46.57 67.43 41.32 71.63C36.07 75.83 33.45 81.59 33.45 88.89C33.45 99.73 41.32 107.14 57.06 111.12L85.26 118.09C98.81 121.19 108.98 126.28 115.76 133.35C122.53 140.21 125.92 149.61 125.92 161.56C125.92 171.74 123.19 180.7 117.73 188.44C112.26 195.96 104.72 201.82 95.1 206.03C85.7 210.01 74.55 212 61.65 212C42.85 212 27.87 207.35 16.72 198.06C5.57 188.77 0 176.38 0 160.9Z',
  'M232.8 212H202.13L202.13 49.76H229.54V77.39C232.8 68.34 239.11 60.66 247.81 54.7C256.73 48.52 267.5 45.43 280.12 45.43C294.26 45.43 306.01 49.29 315.36 57.02C324.72 64.75 330.81 75.01 333.64 87.82H328.09C330.27 75.01 336.25 64.75 346.04 57.02C355.83 49.29 367.9 45.43 382.26 45.43C400.54 45.43 414.89 50.84 425.34 61.66C435.78 72.47 441 87.26 441 106.03V212H410.98V113.65C410.98 100.84 407.71 91.02 401.19 84.17C394.88 77.11 386.29 73.58 375.41 73.58C367.79 73.58 361.05 75.34 355.17 78.88C349.52 82.19 345.06 87.04 341.8 93.45C338.53 99.85 336.9 107.36 336.9 115.97V212H306.55V113.32C306.55 100.51 303.4 90.8 297.09 84.17C290.78 77.33 282.19 73.91 271.31 73.91C263.69 73.91 256.95 75.67 251.08 79.21C245.42 82.52 240.96 87.38 237.7 93.78C234.43 99.96 232.8 107.36 232.8 115.97V212Z',
  'M184.83 20.55C184.83 31.9 175.64 41.1 164.29 41.1C152.95 41.1 143.76 31.9 143.76 20.55C143.76 9.2 152.95 0 164.29 0C175.64 0 184.83 9.2 184.83 20.55Z',
  'M179.43 212H149.16V49.76C153.76 51.91 158.88 53.12 164.29 53.12C169.7 53.12 174.83 51.91 179.43 49.76V212Z',
]

/**
 * Canvas of `public/brand/color/email/wordmark.png`, which the header renders
 * instead of these paths because email clients strip inline SVG.
 *
 * **These proportions are frozen.** A sent email is immutable — it keeps the
 * `width`/`height` it was sent with and refetches this URL forever — so an
 * export whose canvas is shaped differently would stretch the mark in every
 * message already delivered. Re-export onto this canvas (the outlines centered
 * at their own aspect, filled with the email palette's `textBody`) and the same
 * file keeps serving old and new mail alike.
 */
export const EMAIL_WORDMARK_CANVAS = { width: 272, height: 164 } as const

/**
 * Display box for the email header wordmark.
 *
 * The landing navbar sizes the mark at its neighbouring text plus 2px above and
 * below (18px ink against 14px chip labels). Email body copy is 16px, so the
 * mark wants to stand ~20px tall. The canvas insets the outlines, so a 26px box
 * renders 20.7px of ink; the width follows {@link EMAIL_WORDMARK_CANVAS}. Both
 * dimensions are pinned because email clients do no responsive image selection.
 *
 * Retuning this box is safe on its own — the canvas is 6x the box, so the mark
 * stays crisp, and older mail keeps rendering against its own numbers.
 */
export const EMAIL_WORDMARK_SIZE = { width: 43, height: 26 } as const
