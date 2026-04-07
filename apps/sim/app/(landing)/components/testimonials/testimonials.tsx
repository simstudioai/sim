/**
 * Testimonials section — social proof via user quotes.
 *
 * SEO:
 * - `<section id="testimonials" aria-labelledby="testimonials-heading">`.
 * - `<h2 id="testimonials-heading">` for the section title.
 * - Each testimonial: `<blockquote cite="tweet-url">` with `<footer><cite>Author</cite></footer>`.
 * - Profile images use `loading="lazy"` (below the fold).
 *
 * GEO:
 * - Keep quote text as plain text in `<blockquote>` — not split across `<span>` elements.
 * - Include full author name + handle (LLMs weigh attributed quotes higher).
 * - Testimonials mentioning "Sim" by name carry more citation weight.
 * - Review data here aligns with `review` entries in structured-data.tsx.
 */
export default function Testimonials() {
  return null
}
