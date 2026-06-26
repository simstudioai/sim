import type { ReactNode } from 'react'

/**
 * Legal-page content contract — the entire content a legal route passes to
 * {@link ProsePage}. Every field is content-only: copy strings plus `ReactNode`
 * for inline rich text (bold terms, mailto links via {@link ProseLink}). There
 * is deliberately no `className`, `style`, or layout knob anywhere in this tree;
 * spacing and chrome live entirely in `PROSE_SPACING`/`PROSE_TYPE`. A page
 * describes WHAT to show; the layout decides WHERE and with how much space.
 *
 * Both Terms and Privacy are rendered by feeding this one primitive a config, so
 * the two documents share a single layout and can never visually drift.
 */

/** A single rendered block within a legal section (or the page intro). */
export type LegalBlock =
  /** A body paragraph. `content` may carry inline `<strong>` / {@link ProseLink}. */
  | { kind: 'paragraph'; content: ReactNode }
  /** A sub-heading inside a section — rendered as `<h3>`. */
  | { kind: 'subheading'; text: string }
  /** A bulleted list. Each item may carry inline rich text. */
  | { kind: 'list'; items: ReactNode[] }
  /** An emphasized callout box (e.g. the arbitration / GDPR notices). */
  | { kind: 'callout'; content: ReactNode }

/** A numbered (or named) legal section — an `<h2>` plus its ordered blocks. */
export interface LegalSection {
  /** Stable id for the `<section>` landmark and `aria-labelledby` wiring. */
  id: string
  /** The section's `<h2>` heading. */
  heading: string
  /** The section's ordered content blocks. */
  blocks: LegalBlock[]
}

/** The complete legal page: hero copy plus intro blocks and ordered sections. */
export interface LegalPageConfig {
  /** The page's single `<h1>` (e.g. "Terms of Service"). */
  title: string
  /** Constitution-compliant lead beneath the heading, in the body color. */
  description: string
  /** The "Last updated" date string (e.g. "October 11, 2025"). */
  lastUpdated: string
  /** Intro blocks rendered under the `<h1>`, before the first numbered section. */
  intro: LegalBlock[]
  /** The ordered legal sections. */
  sections: LegalSection[]
}
