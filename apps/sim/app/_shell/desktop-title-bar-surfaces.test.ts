/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Raw file contents, anchored to this file rather than `process.cwd()`. */
const readRaw = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8')

/**
 * Source with comments removed.
 *
 * EVERY assertion here runs on stripped source — which is why {@link read} strips at the
 * point of reading rather than leaving it to each callsite. These files document the very
 * shapes they enforce, in both directions:
 *
 * - a negative like `not.toContain('min-h-screen')` matches the prose explaining why
 *   `min-h-screen` is gone, and fails on correct code;
 * - a positive like `toContain('desktop-title-bar-page')` matches the TSDoc naming the
 *   class, and passes even after the class is deleted from the markup.
 *
 * The second is the dangerous one, and stripping only negatives left it live.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every audit constant below reads through this, so no assertion can match prose. */
const read = (relativePath: string) => stripComments(readRaw(relativePath))

const authLayout = read('../(auth)/layout.tsx')
const authShell = read('../(auth)/components/auth-shell.tsx')
const workspaceChrome = read(
  '../workspace/[workspaceId]/components/workspace-chrome/workspace-chrome.tsx'
)
const sidebar = read('../workspace/[workspaceId]/w/components/sidebar/sidebar.tsx')
const globalStyles = read('../_styles/globals.css')
const desktopTitleBar = read('../_shell/desktop-title-bar.tsx')
const pageHeaderBar = read('../../components/page-header-bar.ts')
const resourceHeader = read(
  '../workspace/[workspaceId]/components/resource/components/resource-header/resource-header.tsx'
)
const mothershipView = read(
  '../workspace/[workspaceId]/home/components/mothership-view/mothership-view.tsx'
)

describe('desktop title-bar surface audit', () => {
  it('reserves the lane for every surface wearing the auth shell', () => {
    // Signup, reset-password, sso, verify, the CLI handoff and the invite pages all wear
    // this shell and sit under the same traffic lights. Reserving only on /login left the
    // rest drawing their logo beneath them; per-route gating could not cover
    // `/invite/[id]` either, so the shell owns the lane unconditionally.
    expect(authShell).toContain('desktop-title-bar-page')
    expect(authShell).toContain('<DesktopTitleBarLane />')
    expect(authShell).not.toContain('reserveDesktopTitleBar')
    expect(authShell).not.toContain('min-h-screen')
    expect(authLayout).toContain('<AuthShell>')
  })

  it('mounts a real drag surface across login and workspace title-bar lanes', () => {
    const dragRegion = globalStyles.match(/\.desktop-window-drag-region\s*\{([^}]*)\}/)?.[1]

    expect(desktopTitleBar).toContain('desktop-login-window-drag-region')
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

  it('reserves the login lane inside the box, never as a collapsing margin', () => {
    // `body` carries `min-height: 100vh`, and a `margin-top` here collapses through it
    // (body is a plain block box, so it opens no BFC) and displaces body itself. The
    // document then measured one full lane taller than the viewport, which is what made
    // the desktop login page scroll. Verified live: 40px of overflow, now 0.
    const rule = globalStyles.match(/\.desktop-title-bar-page \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('padding-top: var(--desktop-title-bar-height)')
    expect(rule).toContain('min-height: 100vh')
    expect(rule).not.toContain('margin-top')
  })

  it('drops the content pane border where the pane meets the window edge', () => {
    // Collapsing the sidebar in the desktop shell takes the pane's padding to 0, so a
    // retained border and radius drew a hairline outline inset from the square window.
    const flush = '[[data-sim-desktop-title-bar=inset]_[data-sidebar-collapsed]_&]:'
    expect(workspaceChrome).toContain(`${flush}rounded-none`)
    expect(workspaceChrome).toContain(`${flush}border-0`)
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

/**
 * Every full-viewport page root outside workspace chrome, and why it is safe.
 *
 * A root that fills the viewport and is NOT lane-aware draws its top chrome underneath
 * the macOS traffic lights, because the pre-paint script marks the lane on every desktop
 * route whether or not the page reserves it. That is one bug that has now surfaced four
 * separate times — workspace headers, signup, the CLI handoff, the OAuth error page —
 * each found by a person hitting it rather than by a check.
 *
 * So the check enumerates instead of listing what to look at: any new full-viewport root
 * fails here until it either composes `.desktop-title-bar-page` or is added below with a
 * reason. Reaching for this allowlist should feel like a claim you have to defend — the
 * entry that read "marketing chrome, not reachable in the desktop shell" was false, and
 * hid four live surfaces behind one unverified sentence.
 *
 * Granularity is per FILE, not per JSX root: a file holding two full-viewport roots still
 * passes if only one reserves the lane. Catching that needs an AST pass, which is not
 * worth the weight here — the check's job is to stop a whole surface being forgotten,
 * which is how every instance of this bug actually shipped.
 */
const LANE_EXEMPT: Record<string, string> = {
  'app/(landing)/components/landing-shell/landing-shell.tsx':
    'Marketing chrome. Verified: every consumer lives under app/(landing)/, and the desktop shell boots to /login or a workspace with no path to those routes.',
  'app/playground/page.tsx':
    'Verified dev-only: the page calls notFound() unless NEXT_PUBLIC_ENABLE_PLAYGROUND is set.',
  'app/workspace/[workspaceId]/w/[workflowId]/components/error/index.tsx':
    'Renders <Sidebar>, which owns the workspace lane and its drag region (sidebar.tsx). Padding this root too would double the reservation.',
}

/**
 * Shells that reserve the lane for whatever they wrap.
 *
 * Matched as JSX usage (`<AuthShell`), never as a bare identifier: an import line, or a
 * shell's own definition file mentioning its name, would otherwise self-certify as
 * covered. Both mistakes were in the first draft of this check and made it unfailable.
 */
const LANE_AWARE_SHELL_USAGE = /<(AuthShell|LogoShell|WorkspaceChrome)\b/

describe('desktop traffic-light lane coverage', () => {
  it('leaves no full-viewport root outside workspace chrome unaccounted for', () => {
    const appDir = new URL('../', import.meta.url)
    const files = readdirSync(appDir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `app/${f}`)

    const unaccounted = files.filter((file) => {
      const source = read(`../${file.slice('app/'.length)}`)
      const fillsViewport = /\b(min-h-screen|h-screen)\b/.test(source)
      if (!fillsViewport) return false
      // Composition counts: a surface is covered if it wears a shell that reserves the
      // lane. `LogoShell` was previously allowlisted as marketing chrome — a claim that
      // was simply false, and it hid not-found, the interfaces shell, the desktop handoff
      // shell and the public-file access gates behind one wrong sentence.
      const laneAware =
        source.includes('desktop-title-bar-page') || LANE_AWARE_SHELL_USAGE.test(source)
      return !laneAware && !(file in LANE_EXEMPT)
    })

    expect(unaccounted).toEqual([])
  })

  it('never reserves the lane without also making it draggable', () => {
    const appDir = new URL('../', import.meta.url)
    const orphaned = readdirSync(appDir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `app/${f}`)
      .filter((file) => {
        const source = read(`../${file.slice('app/'.length)}`)
        // The class alone clears the lights but leaves the strip undraggable, so the
        // window loses its title bar on that page. Shipped that way twice in this PR.
        return source.includes('desktop-title-bar-page') && !/<DesktopTitleBarLane\b/.test(source)
      })

    expect(orphaned).toEqual([])
  })
})
