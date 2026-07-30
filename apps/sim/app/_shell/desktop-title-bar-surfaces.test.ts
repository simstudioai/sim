/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Anchored to this file, not `process.cwd()`, which only resolves from `apps/sim`. */
const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const authLayout = read('../(auth)/auth-layout-client.tsx')
const authShell = read('../(auth)/components/auth-shell.tsx')
const workspaceChrome = read(
  '../workspace/[workspaceId]/components/workspace-chrome/workspace-chrome.tsx'
)
const sidebar = read('../workspace/[workspaceId]/w/components/sidebar/sidebar.tsx')
const globalStyles = read('../_styles/globals.css')
const pageHeaderBar = read('../../components/page-header-bar.ts')
const resourceHeader = read(
  '../workspace/[workspaceId]/components/resource/components/resource-header/resource-header.tsx'
)
const mothershipView = read(
  '../workspace/[workspaceId]/home/components/mothership-view/mothership-view.tsx'
)

describe('desktop title-bar surface audit', () => {
  it('applies the safe-area shell only when the auth route is login', () => {
    expect(authLayout).toContain("usePathname() === '/login'")
    expect(authLayout).toContain('reserveDesktopTitleBar={isLogin}')
    expect(authShell).toContain(
      "reserveDesktopTitleBar ? 'desktop-title-bar-page' : 'min-h-screen'"
    )
  })

  it('mounts a real drag surface across login and workspace title-bar lanes', () => {
    const dragRegion = globalStyles.match(/\.desktop-window-drag-region\s*\{([^}]*)\}/)?.[1]

    expect(authShell).toContain('desktop-login-window-drag-region')
    expect(workspaceChrome).toContain('desktop-workspace-window-drag-region')
    expect(workspaceChrome).toContain("isCollapsed ? 'h-[var(--desktop-title-bar-height)]' : 'h-2'")
    // The sidebar's lane strip composes the same two classes instead of
    // re-declaring the drag region inline, which had dropped `user-select: none`.
    expect(sidebar).toContain('desktop-window-drag-region desktop-workspace-window-drag-region')
    expect(dragRegion).toContain('-webkit-app-region: drag')
    expect(globalStyles).toContain('.desktop-workspace-window-drag-region')
    expect(globalStyles).toContain('-webkit-app-region: no-drag')
  })

  // Regression: a px clearance shrinks under page zoom while the OS-drawn lights
  // do not, so they end up drawn over the sidebar toggle.
  it('reserves the traffic-light lane from the platform, not hardcoded pixels', () => {
    expect(globalStyles).toContain('--desktop-title-bar-height: env(titlebar-area-height,')
    expect(globalStyles).toContain('--desktop-title-bar-inset-x: env(titlebar-area-x,')

    // Scoped to the desktop block: the `:root` zeros are the deliberate
    // no-lane case, so only the overrides must stay derived.
    const insetBlock = globalStyles.match(
      /html\[data-sim-desktop-title-bar="inset"\]\s*\{([^}]*)\}/
    )?.[1]
    expect(insetBlock).toBeTypeOf('string')
    for (const name of [
      '--desktop-title-bar-control-size',
      '--desktop-title-bar-control-icon-size',
      '--desktop-title-bar-control-offset',
    ]) {
      expect(insetBlock).toMatch(new RegExp(`${name}: calc\\(`))
      expect(insetBlock).not.toMatch(new RegExp(`${name}:\\s*[\\d.]+px`))
    }

    // Both lane consumers read those vars; a literal in either is the bug.
    expect(workspaceChrome).toContain('left-[var(--desktop-title-bar-inset-x)]')
    expect(workspaceChrome).toContain('size-[var(--desktop-title-bar-control-size)]')
    expect(sidebar).toContain('[[data-sim-desktop-title-bar=inset]_&]:pt-[var(')
    expect(sidebar).not.toMatch(/\[\[data-sim-desktop-title-bar=inset\]_&\]:pt-\d/)
  })

  it('defines the content-pane lane once, defaulting to zero', () => {
    // A `:root` default keeps the variable defined for bars that render outside
    // `.workspace-content-shell` (the standalone settings shell at /account,
    // /organization/[id], /selfhost; the landing tables preview). An undefined var()
    // inside calc() is invalid at computed-value time and drops padding-top entirely.
    expect(globalStyles).toMatch(/:root\s*\{[^}]*--workspace-content-title-bar-inset:\s*0px/s)
    // The pane owns the lane in both arrangements where the sidebar is not there to
    // own it: collapsed to zero width, and slid away for a fullscreen route (which
    // leaves the sidebar expanded in the store, so the collapsed selector alone misses
    // it and /upgrade's back chip lands under the traffic lights).
    expect(globalStyles).toContain('.workspace-content-shell[data-sidebar-collapsed],')
    expect(globalStyles).toContain('.workspace-content-shell[data-content-fullscreen] {')
    expect(workspaceChrome).toContain('data-content-fullscreen={isFullscreen || undefined}')
  })

  it('sizes the peek card to its content, capped against the lane', () => {
    // Pinning both edges made the card full height, so a short list (settings) left a
    // tall empty slab over the content. It now hugs its content and caps at the pane
    // height less the lane and the bottom gutter, so a long list still scrolls.
    expect(workspaceChrome).toContain('max-h-[calc(100%-var(--desktop-title-bar-height)-8px)]')
    expect(workspaceChrome).not.toMatch(/PEEK_CARD_CHROME[\s\S]{0,240}?bottom-2/)
  })

  it('clears the lane for panels that embed pages away from the lights', () => {
    // The mothership panel is the right half of the pane and embeds whole pages
    // (KnowledgeBase et al) whose header bars reserve the lane. It inherits the
    // variable, so without this reset those bars gain the inset while sitting nowhere
    // near the traffic lights.
    expect(mothershipView).toContain('[--workspace-content-title-bar-inset:0px]')
  })

  it('reserves that lane in every top-of-pane header bar', () => {
    // Both top-bar geometries must compose the shared lane padding. A bare
    // `pt-`/`py-[8.5px]` in either is the bug: the bar then draws under the traffic
    // lights and the sidebar expander whenever the sidebar is collapsed on desktop.
    expect(pageHeaderBar).toContain('pt-[calc(8.5px+var(--workspace-content-title-bar-inset))]')
    expect(pageHeaderBar).toContain('TITLE_BAR_LANE_PT')

    expect(resourceHeader).toContain('TITLE_BAR_LANE_PT')
    expect(resourceHeader).not.toMatch(/py-\[8\.5px\]/)
  })
})
