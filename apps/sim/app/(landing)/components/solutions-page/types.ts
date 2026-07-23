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

/** The solutions hero - optional tag, header copy, the shared CTA, and a full-width visual. */
export interface SolutionsHeroConfig {
  /** Optional mono chip shown above the page's single `<h1>`. */
  eyebrow?: string
  /**
   * The page's single `<h1>`. Per the constitution it should name the module and
   * "Sim"/"AI workspace" (e.g. "Workflows - the visual builder in Sim, the AI workspace").
   */
  heading: string
  /** Supporting description beneath the heading, in the body color. */
  description: string
  /**
   * Optional visible definition of the page's subject, rendered as a second
   * paragraph beneath {@link description}. Self-contained and answer-first so
   * answer engines can quote it whole ("What is an enterprise AI agent?").
   * Currently honored by the `home` hero variant.
   */
  definition?: string
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
  /**
   * Feature-tile surface tone. Defaults to `'light'` so tiles can mix light
   * and dark backgrounds within the same row.
   */
  featureTileTone?: SolutionsFeatureTileTone
  /**
   * Optional description color on feature tiles. `'soft'` is for lighter body
   * copy on dark surfaces without changing the row's default tone map.
   */
  featureTileDescriptionTone?: 'soft'
}

/** Controlled surface tones for {@link SolutionsCardConfig.featureTileTone}. */
export type SolutionsFeatureTileTone = 'light' | 'dark'

/**
 * A card row - the core repeating unit. A header (title + subtitle + CTA) above a
 * grid of 3 or 4 cards. The grid column count is derived from `cards.length`, so
 * the page never specifies layout - except the optional {@link columns} density
 * override for rows whose cards need more width than their count would grant.
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
  /**
   * Optional second subtitle paragraph - a self-contained follow-on point that
   * would overload {@link subtitle} if merged into it (e.g. self-hosting).
   */
  note?: string
  /** The row's single pill CTA. */
  cta: SolutionsPillCta
  /** The cards in this row - 3 or 4. The grid derives its columns from this length. */
  cards: SolutionsCardConfig[]
  /**
   * Optional desktop column-count override. A 4-card row defaults to four-up,
   * which squeezes tile vignettes; `columns: 2` renders it as a 2×2 grid
   * instead (wrapping keeps the standard inter-tile gap on both axes).
   * Breakpoint collapse (2-col under `lg`, 1-col under `sm`) is unchanged.
   */
  columns?: 2
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
  /**
   * The page's meta description, shared with `page.tsx` so the JSON-LD
   * `WebPage.description` and the `<meta name="description">` never drift.
   * Falls back to `hero.summary` when absent.
   */
  seoDescription?: string
  /**
   * Whether the JSON-LD `WebApplication` advertises the free tier as an
   * `Offer`. Defaults to true; sales-led pages (Enterprise) set false so a
   * rich result never claims a $0 price for a quoted product.
   */
  offersFreeTier?: boolean
  /** The hero (the page's only `<h1>`). */
  hero: SolutionsHeroConfig
  /** Card rows rendered in order beneath the logos row. */
  rows: SolutionsCardRowConfig[]
}
