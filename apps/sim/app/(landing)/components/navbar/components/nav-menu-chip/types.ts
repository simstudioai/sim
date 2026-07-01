/**
 * One destination inside a navbar mega-menu - a title, a one-line description,
 * and a crawlable href. {@link external} routes render as a plain
 * `<a target='_blank' rel='noopener noreferrer'>`; internal routes use Next
 * `<Link>`.
 */
export interface NavMenuItemData {
  /** Item heading (e.g. "Mothership"). */
  title: string
  /** One-line description shown under the title. */
  description: string
  /** Destination - an internal route (`/workflows`) or an absolute URL. */
  href: string
  /** When true, the row is an off-site link opened in a new tab. */
  external?: boolean
}

/**
 * A single navbar dropdown: its trigger label and the flat three-column grid of
 * items it reveals.
 */
export interface NavMenu {
  /** Trigger label and accessible name of the panel (e.g. "Platform"). */
  label: string
  /** The destinations rendered in the panel, in display order. */
  items: readonly NavMenuItemData[]
}
