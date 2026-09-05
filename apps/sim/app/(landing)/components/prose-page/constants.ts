import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'

/**
 * Prose-layout spacing and type - the single source of truth for every gutter,
 * gap, reading-column width, and text token used across the legal pages
 * (Terms, Privacy) and the Changelog. Modeled on the platform page's
 * `PLATFORM_SPACING`: the padding fortress lives here, so a reviewer changes
 * spacing in exactly one place and Terms can never drift from Privacy.
 *
 * No prose component hard-codes a spacing value inline and no consumer page can
 * reach these knobs - a page passes only content (strings + `ReactNode`), and
 * the layout decides where and with how much space.
 *
 * All values are Tailwind class fragments (not raw numbers) so they compose
 * directly into `className` strings and stay legible.
 */
export const PROSE_SPACING = {
  /**
   * The one horizontal gutter, matching the navbar and footer so content starts
   * on the wordmark's vertical line at every width.
   */
  gutter: LANDING_GUTTER,
  /** Outer content cap, matching navbar/footer. */
  outerCap: LANDING_CONTENT_WIDTH,
  /** Top padding that clears the sticky navbar, matching the platform hero. */
  heroTopPadding: 'pt-[112px] max-sm:pt-20',
  /** Vertical rhythm of the content column - hero → body and section → section. */
  bodyRhythm: 'gap-16 max-sm:gap-12',
  /** Hero header sub-stack (title → meta → lead → actions). */
  heroStack: 'gap-5',
  /** Section sub-stack (heading → block group). */
  sectionStack: 'gap-4',
  /** Gap between blocks (paragraphs, lists, subheadings, callouts) within a group. */
  blockStack: 'gap-4',
  /** List-item vertical spacing. */
  listStack: 'space-y-2',
  /** List left indent for the disc marker. */
  listIndent: 'pl-6',
} as const

/**
 * Column widths for the cookie-inventory tables. Sibling tables sharing a header
 * must be given a fixed layout or each sizes itself to its own content and the
 * group reads as unaligned grids — so the widths are chrome, and live here
 * rather than as class strings in a content config.
 */
export const PROSE_TABLE_WIDTHS = {
  cookieInventory: ['w-[24%]', 'w-[16%]', 'w-[45%]', 'w-[15%]'],
} as const

/**
 * Prose type tokens - the single source of truth for every heading size, body
 * color, list, callout, and inline-link treatment. Centralized alongside the
 * spacing fortress so chrome is described once and never re-derived per page.
 * Uses the platform light tokens exclusively (no hex, no `--landing-*`).
 */
export const PROSE_TYPE = {
  h1: 'text-balance text-[40px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px]',
  meta: 'text-[14px] text-[var(--text-muted)]',
  lead: 'max-w-[640px] text-[20px] text-[var(--text-body)] leading-[1.5] max-sm:text-[17px]',
  h2: 'text-[24px] text-[var(--text-primary)] leading-[1.25] max-sm:text-[21px]',
  h3: 'text-[17px] text-[var(--text-primary)] leading-[1.35]',
  body: 'text-[15px] text-[var(--text-body)] leading-[1.65]',
  list: 'text-[15px] text-[var(--text-body)] leading-[1.6] marker:text-[var(--text-muted)]',
  callout:
    'rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[14px] text-[var(--text-body)] leading-[1.6]',
  link: 'text-[var(--text-primary)] underline underline-offset-2 transition-colors hover:text-[var(--text-body)]',
  tableWrap: 'w-full overflow-x-auto',
  tableCaption: 'pb-2 text-left text-[15px] text-[var(--text-primary)]',
  table: 'w-full min-w-[560px] table-fixed border-collapse text-left',
  tableHeadCell:
    'border-[var(--border)] border-b px-3 py-2 align-bottom font-medium text-[13px] text-[var(--text-primary)] first:pl-0 last:pr-0',
  tableCell:
    'border-[var(--border)] border-b px-3 py-2.5 align-top text-[14px] text-[var(--text-body)] leading-[1.55] first:pl-0 last:pr-0 [&_code]:font-mono [&_code]:text-[13px]',
} as const
