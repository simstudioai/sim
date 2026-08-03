/**
 * Top padding for a bar sitting at the very top of the workspace content pane.
 *
 * Folds in `--workspace-content-title-bar-inset`, the height that pane must leave
 * clear for the desktop shell's inset title bar. That variable is `0px` everywhere
 * except the macOS desktop app with the sidebar collapsed — the one arrangement where
 * the pane, rather than the sidebar, sits beneath the traffic lights and the sidebar
 * expander. Without it a top bar draws underneath both, which hides its controls and
 * can leave them unclickable.
 *
 * Compose this rather than writing `pt-[8.5px]`: the app has two top-bar geometries
 * ({@link PAGE_HEADER_BAR} and the `Resource` header's bordered variant), and the lane
 * math has to stay identical across them.
 */
export const TITLE_BAR_LANE_PT = 'pt-[calc(8.5px+var(--workspace-content-title-bar-inset))]'

/**
 * The top-of-page header bar worn by the surfaces that put a back chip, tab switcher,
 * or page actions above their content. `Resource`-based pages (tables, files, logs,
 * knowledge, scheduled tasks) use their own bordered bar and compose
 * {@link TITLE_BAR_LANE_PT} directly.
 *
 * Single source of truth for this geometry — never re-derive it per page.
 */
export const PAGE_HEADER_BAR = `flex flex-shrink-0 items-center bg-[var(--bg)] px-4 ${TITLE_BAR_LANE_PT} pb-[8.5px]`

/**
 * The right-hand action cluster inside a top bar. Every header — settings,
 * credential detail, `Resource` pages, the integrations tab strip — wears this,
 * so a chip row is the same height and rhythm wherever it appears.
 *
 * Single source of truth: never re-derive `h-[30px]`/`gap-1` per header.
 */
export const HEADER_ACTION_CLUSTER = 'flex h-[30px] items-center gap-1'
