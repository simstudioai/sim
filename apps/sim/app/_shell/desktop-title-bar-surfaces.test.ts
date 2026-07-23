/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop title-bar surface audit', () => {
  it('applies the safe-area shell only when the auth route is login', () => {
    const authLayout = readFileSync(
      resolve(process.cwd(), 'app/(auth)/auth-layout-client.tsx'),
      'utf8'
    )
    const authShell = readFileSync(
      resolve(process.cwd(), 'app/(auth)/components/auth-shell.tsx'),
      'utf8'
    )

    expect(authLayout).toContain("usePathname() === '/login'")
    expect(authLayout).toContain('reserveDesktopTitleBar={isLogin}')
    expect(authShell).toContain(
      "reserveDesktopTitleBar ? 'desktop-title-bar-page' : 'min-h-screen'"
    )
  })

  it('mounts a real drag surface across login and workspace title-bar lanes', () => {
    const authShell = readFileSync(
      resolve(process.cwd(), 'app/(auth)/components/auth-shell.tsx'),
      'utf8'
    )
    const workspaceChrome = readFileSync(
      resolve(
        process.cwd(),
        'app/workspace/[workspaceId]/components/workspace-chrome/workspace-chrome.tsx'
      ),
      'utf8'
    )
    const globalStyles = readFileSync(resolve(process.cwd(), 'app/_styles/globals.css'), 'utf8')
    const dragRegion = globalStyles.match(/\.desktop-window-drag-region\s*\{([^}]*)\}/)?.[1]

    expect(authShell).toContain('desktop-login-window-drag-region')
    expect(workspaceChrome).toContain('desktop-workspace-window-drag-region')
    expect(workspaceChrome).toContain("isCollapsed ? 'h-9' : 'h-2'")
    expect(dragRegion).toContain('-webkit-app-region: drag')
    expect(globalStyles).toContain('.desktop-workspace-window-drag-region')
    expect(globalStyles).toContain('-webkit-app-region: no-drag')
  })
})
