/**
 * Icon-only controls in the resource header — add, preview mode, the per-resource
 * actions — fill the tab strip's control band, so they match the strip's own
 * new-tab button and the panel's collapse toggle and the header reads as one row.
 */
export const RESOURCE_TAB_ICON_BUTTON_CLASS = 'size-[var(--tab-strip-band,30px)] shrink-0 p-0'

export const RESOURCE_TAB_ICON_CLASS = 'size-[16px] text-[var(--text-icon)]'

/** Shared geometry for the resource header and controls positioned over it. */
export const RESOURCE_HEADER_CLASSES = {
  layout:
    '[--resource-header-controls-height:40px] [--resource-header-end-inset:16px] [--resource-header-fixed-reserve:64px] [--resource-header-toggle-hit-size:40px] [--resource-header-toggle-size:30px]',
  /**
   * Drives the tab strip from this header's own tokens rather than restating the
   * strip's defaults, so the height the overlaid controls below are positioned
   * against and the height the strip renders at cannot drift apart. Set on the
   * strip itself, not an ancestor — the browser and terminal strips nested in
   * this panel keep their own geometry.
   *
   * The `+ 1px` is the strip's own bottom border. The controls height is the
   * CONTENT box both clusters centre in, so the strip's box has to be a pixel
   * taller than it or the tabs would centre in 43px while the overlaid toggle
   * centres in 44px, and the two rows would sit half a pixel apart.
   *
   * The band is the tabs' own height, set below the 30px the collapse toggle
   * keeps: a tab paints a fill, so its box is visible and wants air around it,
   * where the toggle and the action buttons are bare glyphs whose box only shows
   * on hover.
   */
  stripGeometry:
    '[--tab-strip-height:calc(var(--resource-header-controls-height)_+_1px)] [--tab-strip-band:26px] [--tab-strip-max-tab-width:160px] [--tab-strip-inline-start:var(--resource-header-end-inset)] [--tab-strip-inline-end:var(--resource-header-fixed-reserve)]',
  /**
   * Centred, matching the `floating` strip: its tabs and controls sit centred in
   * the header band rather than hanging from the top, so an overlaid control has
   * to centre too or it lands a pixel below the row it belongs to.
   */
  overlay: 'absolute top-0 flex h-[var(--resource-header-controls-height)] items-center',
  endPosition: 'right-[var(--resource-header-end-inset)]',
  /**
   * Clears the collapse toggle's 40px hit target so adjacent controls never
   * compete for the same pointer area. The visible toggle remains 30px.
   */
  adjacentEndPosition:
    'right-[calc(var(--resource-header-end-inset)_+_var(--resource-header-toggle-hit-size)_+_1px)]',
  emptyAddOffset: '-translate-x-1.5',
} as const
