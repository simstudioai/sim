import type { ReactNode } from 'react'

/**
 * Solutions-page configuration - the entire content contract a route passes to
 * {@link SolutionsPage}. Every field is content-only: strings for copy, `ReactNode`
 * exclusively for the designated visual/animation slots, and typed config arrays
 * for card rows. There is deliberately no `className`, `style`, width, height,
 * padding, margin, or any other layout knob anywhere in this tree - spacing
 * lives entirely inside the components (see `SOLUTIONS_SPACING`). A page describes
 * WHAT to show; the layout decides WHERE and with how much space.
 */

/** A single pill call-to-action - label plus destination, used by card rows. */
export interface SolutionsPillCta {
  /** Visible link text. A trailing arrow is added by the component. */
  label: string
  /** Destination href. Internal hrefs render as Next `<Link>`; external as a safe anchor. */
  href: string
}

/** The solutions hero - header copy, the shared CTA, and a full-width visual. */
export interface SolutionsHeroConfig {
  /**
   * The page's single `<h1>`. Per the constitution it should name the module and
   * "Sim"/"AI workspace" (e.g. "Workflows - the visual builder in Sim, the AI workspace").
   */
  heading: string
  /** Supporting description beneath the heading, in the body color. */
  description: string
  /**
   * ~50-word sr-only atomic summary for AI citation (GEO). Names "Sim" explicitly
   * and states what the module is, who it's for, and what it does.
   */
  summary: string
  /**
   * The full-width hero visual - a page-supplied client island or static panel.
   * Renders into a component-owned frame with reserved aspect ratio (CLS = 0) and
   * is marked `aria-hidden`; it owns nothing about the frame's chrome or spacing.
   */
  visual: ReactNode
}

/** A single card - text plus a reserved visual panel. Rendered as an `<article>`. */
export interface SolutionsCardConfig {
  /** The card's `<h3>` title. */
  title: string
  /**
   * Supporting description beneath the title, in the body color. Self-contained
   * and names "Sim" - never "the platform" or a bare pronoun - so each card is an
   * independently quotable answer block.
   */
  description: string
  /**
   * The card's visual/animation - a page-supplied node. Renders into a
   * component-owned, fixed-height frame (CLS = 0), marked `aria-hidden`. The card
   * owns the spacing around both the text and this frame.
   */
  visual: ReactNode
}

/**
 * A card row - the core repeating unit. A header (title + subtitle + CTA) above a
 * grid of 3 or 4 cards. The grid column count is derived from `cards.length`, so
 * the page never specifies layout.
 */
export interface SolutionsCardRowConfig {
  /**
   * Stable section id for the `<section>` landmark and `aria-labelledby` wiring.
   * Must be unique within the page (e.g. `'build'`).
   */
  id: string
  /** The row's `<h2>` title, in the headline color - reads as an answer to a user question. */
  title: string
  /** Supporting subtitle beneath the title, in the body color, naming "Sim". */
  subtitle: string
  /** The row's single pill CTA. */
  cta: SolutionsPillCta
  /** The cards in this row - 3 or 4. The grid derives its columns from this length. */
  cards: SolutionsCardConfig[]
}

/**
 * The complete solutions-page content: page identity (for structured data), one
 * hero, plus ordered card rows. A route passes exactly this object to
 * {@link SolutionsPage} and nothing else.
 */
export interface SolutionsPageConfig {
  /** Module name, e.g. "Workflows" - used in the breadcrumb and schema.org name. */
  module: string
  /** Canonical path, e.g. "/workflows" - used to build the JSON-LD `url`/breadcrumb. */
  path: string
  /** The hero (the page's only `<h1>`). */
  hero: SolutionsHeroConfig
  /** Card rows rendered in order beneath the logos row. */
  rows: SolutionsCardRowConfig[]
}
