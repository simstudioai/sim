export type NavMenuPreviewKind =
  | 'blog'
  | 'changelog'
  | 'docs'
  | 'integrations'
  | 'library'
  | 'models'
  | 'overview'
  | 'enterprise'
  | 'files'
  | 'knowledge'
  | 'logs'
  | 'resource'
  | 'tables'
  | 'team'
  | 'workflows'

export interface NavMenuPreview {
  /** Visual grammar used by the code-native product preview. */
  kind: NavMenuPreviewKind
  /** Small context label above the preview title. */
  eyebrow: string
  /** Preview headline. */
  title: string
  /** Three real product details rendered inside the preview surface. */
  details: readonly [string, string, string]
}

/**
 * One destination inside a navbar mega-menu - a title, a one-line description,
 * and a crawlable href. {@link external} routes render as a plain
 * `<a target='_blank' rel='noopener noreferrer'>`; internal routes use Next
 * `<Link>`.
 */
export interface NavMenuItemData {
  /** Muted product prefix, used by Sim modules. */
  brand?: string
  /** Item heading (e.g. "Knowledge Base"). */
  title: string
  /** One-line description shown under the title. */
  description: string
  /** Destination - an internal route (`/workflows`) or an absolute URL. */
  href: string
  /** When true, the row is an off-site link opened in a new tab. */
  external?: boolean
  /** Content and graphic shown when this item is hovered or focused. */
  preview: NavMenuPreview
  /** For a `floating` menu: the wordmark shown centred on the bloc's white placement. */
  card?: NavMenuCard
}

/** The image placement on a customer bloc - a wordmark sized by optical height at its own aspect. */
export interface NavMenuCard {
  imageSrc: string
  imageAlt: string
  /** Intrinsic width ÷ height, so the mark scales without distortion. */
  aspect: number
  /** Display height in px, tuned by eye for the placement. */
  height: number
  /**
   * The placement's ground: `dark` flattens the mark to white on dark grey,
   * `light` keeps its ink on light grey. With a {@link background} the tone
   * is the ground behind the picture while it loads.
   */
  tone: 'dark' | 'light'
  /** A picture filling the placement under the mark, for a `dark` tone. */
  background?: {
    /** Path under `/public`; the tile shows it cropped to cover. */
    src: string
  }
}

/** One labeled column of destinations inside a mega-menu. */
export interface NavMenuSection {
  /** Section label, e.g. "Build" or "Operate". */
  label: string
  /** Destinations in reading order. */
  items: readonly [NavMenuItemData, ...NavMenuItemData[]]
}

/**
 * A single navbar dropdown with an editorial introduction, grouped destinations,
 * and one dynamic preview region.
 */
export interface NavMenu {
  /** Trigger label and accessible name of the panel. */
  label: string
  /** Small label above the menu heading. */
  eyebrow: string
  /** Menu-level positioning statement. */
  heading: string
  /** Supporting menu-level copy. */
  description: string
  /** Grouped destinations rendered in the panel. */
  sections: readonly [NavMenuSection, ...NavMenuSection[]]
  /**
   * How the desktop menu presents its destinations. The default is the
   * full-width surface with columns and a preview region; `floating` renders
   * every item as an image bloc inside a compact panel that floats under the
   * menu's own trigger (customer stories).
   */
  layout?: 'floating'
  /** Slide the shared customer wordmarks under a `floating` menu's blocs. */
  marquee?: 'customers'
}
