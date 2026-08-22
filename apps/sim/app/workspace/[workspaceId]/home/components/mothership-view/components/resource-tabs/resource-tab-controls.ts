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
    '[--resource-header-controls-height:34px] [--resource-header-end-inset:16px] [--resource-header-fixed-reserve:54px] [--resource-header-toggle-size:30px]',
  /**
   * Drives the tab strip from this header's own tokens rather than restating the
   * strip's defaults, so the height the overlaid controls below are positioned
   * against and the height the strip renders at cannot drift apart. Set on the
   * strip itself, not an ancestor — the browser and terminal strips nested in
   * this panel keep their own geometry.
   */
  stripGeometry:
    '[--tab-strip-height:var(--resource-header-controls-height)] [--tab-strip-inline-start:var(--resource-header-end-inset)] [--tab-strip-inline-end:var(--resource-header-fixed-reserve)]',
  /**
   * Bottom-aligned rather than centred: the header's own controls sit in the tab
   * strip's band, one pixel clear of its border, and an overlaid control has to
   * land in that same band to read as part of the row.
   */
  overlay: 'absolute top-0 flex h-[var(--resource-header-controls-height)] items-end pb-px',
  endPosition: 'right-[var(--resource-header-end-inset)]',
  /**
   * Sits a control 1px clear of the overlaid 30px collapse toggle — the same
   * chip-to-chip gap the sidebar header cluster uses (`gap-[1px]`), so the
   * credits chip and the toggle read as one cluster across both surfaces.
   */
  adjacentEndPosition:
    'right-[calc(var(--resource-header-end-inset)_+_var(--resource-header-toggle-size)_+_1px)]',
  emptyAddOffset: '-translate-x-1.5',
} as const
