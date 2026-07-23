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
})
