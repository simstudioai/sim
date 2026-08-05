/**
 * Chrome the interface grid shares, so a module's header and the content
 * beneath it line up instead of each carrying whatever padding its own
 * implementation happened to bring — and so the authoring grid and the shipped
 * page are laid out by one declaration rather than two that happen to agree.
 *
 * Strings and plain style objects — no components, and React only as a
 * type-only `CSSProperties` import — so both the renderers and the canvas can
 * read them.
 */

import type { CSSProperties } from 'react'
import type { InterfaceGrid, InterfacePlacement } from '@/lib/interfaces/types'

/**
 * The horizontal gutter the module frame and its plain-content modules use.
 *
 * `px-4` rather than a smaller value because it is the gutter the chat
 * transcript already has: `ClientChatMessage` is shared with the deployed chat
 * page, so its `px-4` is the one value here that cannot be changed without
 * touching a surface outside interfaces. The cell's header bar, the chat
 * composer, the form, and the chooser column are all aligned to it.
 *
 * **Modules that own their own interface do not take this.** A table renders
 * the EMCN `Table`, and a file renders `FileView` — both bring padding that a
 * dozen other surfaces already depend on, and re-gutter­ing them here would
 * either fight those components or drift from them the next time they change.
 * Their frame still lines up, because the frame is the header bar; only their
 * interior keeps its own rhythm.
 */
export const MODULE_GUTTER_X = 'px-4'

/**
 * The scroll well the grid sits in — the element that owns the page padding and
 * the overflow, in both the authoring canvas and the shipped page (including
 * its empty state, so an interface with no modules is inset exactly like one
 * with modules).
 *
 * Shared because the preview's whole promise is that it cannot lie about the
 * page: a `p-4` nudged on one surface alone would move every module by 4px
 * relative to the other and make the editor a slightly wrong picture of what
 * ships.
 */
export const INTERFACE_SCROLL_WELL_CLASS = 'relative min-w-0 flex-1 overflow-auto p-4'

/**
 * The grid itself. Track counts come from the `--interface-cols` /
 * `--interface-rows` custom properties {@link interfaceGridStyle} sets, so this
 * string never assumes a shape and both surfaces can reuse it verbatim.
 *
 * Shared for the same reason as the well, and more sharply: the `gap-2` is the
 * seam between modules, so changing it on one grid only is precisely the drift
 * that would make the preview disagree with the page it previews.
 */
export const INTERFACE_GRID_CLASS =
  'grid h-full min-h-0 gap-2 [grid-template-columns:repeat(var(--interface-cols),minmax(0,1fr))] [grid-template-rows:repeat(var(--interface-rows),minmax(0,1fr))]'

/**
 * The phone layout, added to {@link INTERFACE_GRID_CLASS} by the shipped page
 * only: below `sm` the authored tracks are dropped and the modules flow in DOM
 * order at their own height.
 *
 * Not applied to the authoring canvas — an author is composing a shape, and a
 * grid that silently restacks itself would make the placement they are dragging
 * to unreadable.
 */
export const INTERFACE_GRID_STACK_SM_CLASS =
  'max-sm:h-auto max-sm:[grid-template-columns:minmax(0,1fr)] max-sm:[grid-template-rows:none]'

/**
 * The grid's track counts, as the custom properties
 * {@link INTERFACE_GRID_CLASS} reads.
 *
 * Custom properties rather than inline `grid-template-*`: an inline `style`
 * outranks every media query, so a literal template could not be dropped for
 * {@link INTERFACE_GRID_STACK_SM_CLASS}. They are also SSR-safe and need no JS,
 * so there is no hydration flash and no layout jump.
 */
export function interfaceGridStyle(grid: InterfaceGrid): CSSProperties {
  return {
    '--interface-cols': grid.cols,
    '--interface-rows': grid.rows,
  } as CSSProperties
}

/**
 * One module's grid area, as the `--module-row` / `--module-col` custom
 * properties both `InterfaceCell` and `InterfacePane` consume.
 *
 * Custom properties for the same reason as {@link interfaceGridStyle}: the pane
 * has to be able to leave the grid below `sm`, which an inline `gridRow` would
 * outrank. One function rather than one per surface because the `+ 1` is the
 * conversion from the domain's 0-based {@link InterfacePlacement} to CSS's
 * 1-based lines — an off-by-one that must be made identically on both sides or
 * the preview would place modules a track away from where they were authored.
 */
export function modulePlacementStyle(placement: InterfacePlacement): CSSProperties {
  return {
    '--module-row': `${placement.row + 1} / span ${placement.rowSpan}`,
    '--module-col': `${placement.col + 1} / span ${placement.colSpan}`,
  } as CSSProperties
}
