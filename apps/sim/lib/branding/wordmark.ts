/**
 * Canvas of `public/brand/color/email/wordmark.png`, used by email headers
 * because email clients strip inline SVG.
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
