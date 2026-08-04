export const RESOURCE_TAB_GAP_CLASS = 'gap-1.5'

export const RESOURCE_TAB_ICON_BUTTON_CLASS = 'shrink-0 bg-transparent px-2 py-[5px] text-caption'

export const RESOURCE_TAB_ICON_CLASS = 'size-[16px] text-[var(--text-icon)]'

/** Shared geometry for the resource header and controls positioned over it. */
export const RESOURCE_HEADER_CLASSES = {
  layout:
    '[--resource-header-controls-height:43px] [--resource-header-end-inset:16px] [--resource-header-fixed-reserve:54px]',
  bar: 'h-[calc(var(--resource-header-controls-height)_+_1px)]',
  controls: 'h-[var(--resource-header-controls-height)]',
  contentTop: 'top-[8.5px]',
  startPadding: 'pl-[var(--resource-header-end-inset)]',
  endPadding: 'pr-[var(--resource-header-end-inset)]',
  fixedEndPadding: 'pr-[var(--resource-header-fixed-reserve)]',
  endPosition: 'right-[var(--resource-header-end-inset)]',
  adjacentEndPosition: 'right-[var(--resource-header-fixed-reserve)]',
  emptyAddOffset: '-translate-x-1.5',
} as const
