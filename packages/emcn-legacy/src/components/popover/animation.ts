/**
 * Radix popover open/close animation classes — fade + zoom + directional slide,
 * with `motion-reduce` opt-out. Shared across emcn popover-style surfaces
 * (`Popover`, `ChipDatePicker`, and consumers that build their own popover
 * content). Apply alongside a surface's own layout/background classes.
 */
export const POPOVER_ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'
