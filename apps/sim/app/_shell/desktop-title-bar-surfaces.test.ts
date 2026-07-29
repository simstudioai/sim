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
})
