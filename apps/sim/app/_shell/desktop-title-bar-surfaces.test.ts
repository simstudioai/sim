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
const logoShell = read('../(landing)/components/logo-shell/logo-shell.tsx')
const pageHeaderBar = read('../../components/page-header-bar.ts')
const settingsHeader = read('../../components/settings/settings-header.tsx')
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

  it('keeps the lane on the shell the non-auth desktop surfaces wear', () => {
    // `LogoShell` backs not-found, the interfaces shell (chat, resume), the desktop handoff
    // and the public-file gates. It needs its own assertion rather than relying on the
    // enumeration: it sits under the `app/(landing)/` prefix allowlist, and stripping its
    // reservation would also strip its last viewport token, so the sweep would fall silent
    // on the very shell those surfaces depend on.
    expect(logoShell).toContain('desktop-title-bar-page')
    expect(logoShell).toContain('<DesktopTitleBarLane />')
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
    // The env() term is the platform-derived part; the max() floor keeps the
    // lane from collapsing below the OS-drawn lights under page zoom.
    expect(globalStyles).toContain('--desktop-title-bar-height: max(env(titlebar-area-height,')
    expect(globalStyles).toContain('--desktop-title-bar-inset-x: max(env(titlebar-area-x,')

    // Scoped to the desktop block: the `:root` zeros are the deliberate
    // no-lane case, so only the overrides must stay derived.
    const insetBlock = globalStyles.match(
      /html\[data-sim-desktop-title-bar="inset"\]\s*\{([^}]*)\}/
    )?.[1]
    expect(insetBlock).toBeTypeOf('string')
    // The zoom rework split the lane from the control: the lane stays
    // platform-derived (clamped env() above), while the control is a fixed
    // square — CSS px already scale under page zoom, so only the centering
    // offset must remain computed from the lane height.
    expect(insetBlock).toMatch(/--desktop-title-bar-control-offset: calc\(/)
    expect(insetBlock).not.toMatch(/--desktop-title-bar-control-offset:\s*[\d.]+px/)
    for (const name of [
      '--desktop-title-bar-control-size',
      '--desktop-title-bar-control-icon-size',
    ]) {
      expect(insetBlock).toMatch(new RegExp(`${name}:\\s*[\\d.]+px`))
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

  it('drops the pane divider where the pane meets the window edge', () => {
    // The pane meets the rail on a single left hairline. Collapsing the sidebar in the
    // desktop shell leaves no rail beside it, so a retained divider would draw a stray
    // line down the window's left edge. The pane carries no radius or full border to
    // drop anymore; the divider is the only chrome between them.
    const flush = '[[data-sim-desktop-title-bar=inset]_[data-sidebar-collapsed]_&]:'
    expect(workspaceChrome).toContain(`${flush}border-l-0`)
    expect(workspaceChrome).not.toContain('rounded-[8px]')
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

  it('keeps top-level settings headers aligned when the desktop sidebar collapses', () => {
    expect(settingsHeader).toContain('!back && COLLAPSED_DESKTOP_TOP_LEVEL_INSET')
    expect(settingsHeader).toContain(
      '[[data-sim-desktop-title-bar=inset]_[data-sidebar-collapsed]_&]:[--workspace-content-title-bar-inset:9px]'
    )
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
 * reason.
 *
 * Known limit: a root is in scope because of how it claims the viewport, so deleting the
 * reservation outright — class gone, nothing put back — also drops the file from the check.
 * That regression is loud rather than silent (the surface stops being full height, which is
 * plainly visible), and closing it properly means treating every route entry point as a
 * window root, which pulls in seven account/organization/selfhost pages that each need
 * their own assessment. Worth doing; not worth guessing at here. Reaching for this allowlist should feel like a claim you have to defend — the
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
  'app/workspace/[workspaceId]/components/session-expired/session-expired.tsx':
    'Centres its content (`items-center justify-center`) with no chrome in the lane, and is a transient sign-out notice.',
  'app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/search-modal.tsx':
    'The `fixed inset-0` here is the scrim, which carries no content. The panel itself is separately positioned at `top-[15%]`, well clear of the lane.',
  'app/_shell/desktop-update-gate.tsx':
    'Blocking overlay that centres its content, with no chrome in the lane. The lights stay usable regardless: under `titleBarStyle: hiddenInset` macOS draws them above the web contents, so web UI cannot cover them — this bug class is app chrome sitting *under* the lights, not the reverse.',
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
/**
 * How a root claims the whole window.
 *
 * `fixed inset-0` counts: it covers the lights as completely as `h-screen`. So does
 * `desktop-title-bar-page` itself, which sets `min-height: 100vh` — without that arm, every
 * surface this PR converted lost its `min-h-screen` token and dropped out of the check
 * entirely, leaving the files most likely to regress unwatched.
 */
/**
 * A root positioned against the viewport rather than its parent.
 *
 * `position: fixed` ignores an ancestor's `padding-top`, so a lane-aware shell does NOT
 * cover it — the chat surfaces sat inside `LogoShell` and still painted at viewport top,
 * under the lights, while this check called them covered. Such a root must reserve for
 * itself, and reserving must not then read as a double reservation.
 */
const ESCAPES_ANCESTOR_PADDING = /fixed inset-0/

const FILLS_VIEWPORT = /\b(min-h-screen|h-screen)\b|fixed inset-0|desktop-title-bar-page/

const LANE_AWARE_SHELL_USAGE = /<(AuthShell|LogoShell|WorkspaceChrome|InterfacesShell)\b/

/**
 * Route trees whose every surface is accounted for by one reason.
 *
 * Prefix form exists because the landing group is dozens of files sharing a single
 * justification; listing them individually would be noise, not scrutiny.
 */
const LANE_EXEMPT_PREFIXES: Record<string, string> = {
  'app/(landing)/':
    'Marketing routes and their overlays. Verified: the desktop shell boots to /login or a workspace and has no navigation path here. `logo-shell.tsx` lives under this prefix but is lane-aware on its own merits, since it is used well outside landing.',
}

const isExempt = (file: string) =>
  file in LANE_EXEMPT || Object.keys(LANE_EXEMPT_PREFIXES).some((prefix) => file.startsWith(prefix))

/**
 * Surfaces a layout returns *instead of* its lane-aware chrome, not inside it.
 *
 * Ancestor resolution is static, so it credits any file under a layout that mentions a
 * lane-aware shell. That is wrong for an early return: `workspace/[workspaceId]/layout.tsx`
 * returns `<WorkspaceAccessDenied />` at the top and only reaches `<WorkspaceChrome>` much
 * later, so at runtime the denied page has no chrome and must reserve for itself. Without
 * this, a regression there would read as inherited and pass.
 *
 * `SessionExpired` is deliberately absent: it renders as a sibling *within* the chrome
 * tree, so its inherited coverage is real.
 */
const SELF_RESERVE_REQUIRED = new Set([
  // Both of its render paths bypass the chrome, so its own reservation is the only one:
  // `layout.tsx` returns it before reaching `<WorkspaceChrome>`, and
  // `WorkspaceHostProvider` — an ancestor of the chrome, not a descendant — returns it
  // instead of its children on a client-side 403. Neither is a double reservation.
  'app/workspace/[workspaceId]/components/workspace-access-denied.tsx',
  // Same shape on the organization surface: `o/[organizationId]/layout.tsx` returns it
  // for a non-member before reaching `<WorkspaceChrome>`.
  'app/o/[organizationId]/components/organization-access-denied.tsx',
])

/** Every file under `app/`, so ancestor layouts can be resolved without extra fs calls. */
const ALL_APP_FILES = new Set(
  readdirSync(new URL('../', import.meta.url), { recursive: true, encoding: 'utf8' }).map(
    (f) => `app/${f}`
  )
)

/** The `layout.tsx` files wrapping a route, nearest first. */
function ancestorLayouts(file: string): string[] {
  const parts = file.split('/')
  const layouts: string[] = []
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = `${parts.slice(0, i).join('/')}/layout.tsx`
    if (candidate !== file && ALL_APP_FILES.has(candidate)) layouts.push(candidate)
  }
  return layouts
}

/**
 * A file that DEFINES a lane-aware shell, rather than wearing one.
 *
 * Such a file sits under the very layout that renders it, so ancestor resolution would
 * call it nested inside itself and report a double reservation. The shell is the reason
 * that layout is lane-aware in the first place.
 */
const DEFINES_LANE_SHELL = /export function (AuthShell|LogoShell|InterfacesShell|WorkspaceChrome)\b/

const reservesLane = (source: string) =>
  source.includes('desktop-title-bar-page') || LANE_AWARE_SHELL_USAGE.test(source)

const sourceOf = (file: string) => read(`../${file.slice('app/'.length)}`)

/** Full-viewport roots outside a lane-aware layout, paired with whether they reserve. */
function viewportRoots() {
  return [...ALL_APP_FILES]
    .filter((f) => f.endsWith('.tsx'))
    .map((file) => {
      const source = sourceOf(file)
      return {
        file,
        fillsViewport: FILLS_VIEWPORT.test(source),
        self: reservesLane(source),
        escapesPadding: ESCAPES_ANCESTOR_PADDING.test(source),
        inherited:
          !SELF_RESERVE_REQUIRED.has(file) &&
          !DEFINES_LANE_SHELL.test(source) &&
          !ESCAPES_ANCESTOR_PADDING.test(source) &&
          ancestorLayouts(file).some((l) => reservesLane(sourceOf(l))),
      }
    })
    .filter((r) => r.fillsViewport)
}

describe('desktop traffic-light lane coverage', () => {
  it('leaves no full-viewport root unaccounted for', () => {
    // Covered means the root reserves the lane itself OR sits inside a layout that does —
    // chat and the workspace overlays inherit theirs, and requiring the file itself to
    // reserve would force a second, doubled reservation on every one of them.
    const unaccounted = viewportRoots()
      .filter((r) => !r.self && !r.inherited && !isExempt(r.file))
      .map((r) => r.file)

    expect(unaccounted).toEqual([])
  })

  it('never reserves the lane twice by nesting', () => {
    // A root inside a lane-aware layout that reserves again gets two lots of padding, two
    // drag strips and two controllers. Shipped exactly that on the resume loading skeleton,
    // and the file-local check could not see it.
    const doubled = viewportRoots()
      .filter((r) => r.self && r.inherited && !r.escapesPadding)
      .map((r) => r.file)

    expect(doubled).toEqual([])
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
