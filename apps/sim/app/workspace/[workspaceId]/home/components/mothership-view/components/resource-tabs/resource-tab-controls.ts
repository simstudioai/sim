export const RESOURCE_TAB_GAP_CLASS = 'gap-1.5'

export const RESOURCE_TAB_ICON_BUTTON_CLASS = 'shrink-0 bg-transparent px-2 py-[5px] text-caption'

export const RESOURCE_TAB_ICON_CLASS = 'size-[16px] text-[var(--text-icon)]'

/** Shared geometry for the resource header and controls positioned over it. */
export const RESOURCE_HEADER_CLASSES = {
  layout:
    '[--resource-header-controls-height:43px] [--resource-header-end-inset:16px] [--resource-header-fixed-reserve:54px] [--resource-header-toggle-size:30px]',
  bar: 'h-[calc(var(--resource-header-controls-height)_+_1px)]',
  overlay: 'absolute top-0 flex h-[var(--resource-header-controls-height)] items-center',
  startPadding: 'pl-[var(--resource-header-end-inset)]',
  endPadding: 'pr-[var(--resource-header-fixed-reserve)]',
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
