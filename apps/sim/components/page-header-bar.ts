/**
 * The canonical top-of-page header bar worn by every workspace surface that puts a
 * back chip, tab switcher, or page actions above its content (settings, integrations,
 * skills, credential and block detail, upgrade).
 *
 * Single source of truth for that chrome — never re-derive the geometry per page. It
 * was previously copied verbatim into seven files, which is how every one of them came
 * to overlap the macOS traffic lights at once.
 *
 * The top padding folds in `--workspace-content-title-bar-inset`, the height the
 * workspace content pane must leave clear for the desktop shell's inset title bar.
 * That variable is `0px` everywhere except the macOS desktop app with the sidebar
 * collapsed — the only arrangement where the content pane, rather than the sidebar,
 * sits beneath the traffic lights and the sidebar expander — so this is inert on the
 * web and costs consumers nothing.
 */
export const PAGE_HEADER_BAR =
  'flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[calc(8.5px+var(--workspace-content-title-bar-inset))] pb-[8.5px]'
