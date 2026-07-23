# Sim Desktop (macOS)

A thin Electron shell around the hosted Sim web app. The renderer loads the configured origin (default `https://sim.ai`) as a normal top-level page in a bundled, pinned Chromium — rendering is identical to Chrome of that version on every machine. No UI is re-implemented and no server stack is bundled.

## Layout

```
src/main/           # main process (bundled to dist/main.cjs)
  index.ts          # lifecycle + wiring
  config.ts         # origin + settings store (userData/settings.json)
  navigation.ts     # navigation classifier + openExternalSafe
  windows.ts        # window.open policy (single-window, MCP popup, blank children)
  window.ts         # secure BrowserWindow, permissions, crash/hang recovery
  security-guards.ts# global web-contents guards, TLS policy
  handoff.ts        # 127.0.0.1 loopback login handoff + token redeem
  session-lifecycle.ts # sign-out teardown, 401 watcher, connect intercept
  load-health.ts    # offline/error page, auto-retry, watchdog
  local-filesystem.ts # session-scoped read-only directory grants + localfs:// broker
  downloads.ts      # will-download handling
  context-menu.ts   # native right-click + spellcheck
  telemetry-policy.ts # third-party analytics blocking
  observability.ts  # JSONL event log (userData/logs/desktop-events.log)
  updater.ts        # electron-updater wiring, channels, downgrade/block guards
  menu.ts           # role-based macOS menus
src/preload/        # contextBridge IPC bridge (bundled to dist/preload.cjs)
static/             # bundled local pages (offline.html)
e2e/                # Playwright _electron smoke suite
```

## Local development

```bash
bun install                 # workspace root
cd apps/desktop
bun run dev                 # bundle + launch against https://sim.ai
SIM_DESKTOP_ORIGIN=http://localhost:3000 bun run dev   # against local sim
```

- `bun run test` — vitest unit suite (electron is mocked; runs anywhere).
- `bun run test:e2e` — Playwright `_electron` smoke suite against a fixture origin (macOS, real Electron window).
- `bun run type-check` / `lint:check` — standard workspace checks; CI picks these up automatically via `turbo run`.
- `SIM_DESKTOP_USER_DATA=<dir>` isolates settings/partition state (used by e2e).

Everything is bundled by esbuild into `dist/main.cjs` + `dist/preload.cjs` — including `electron-updater` and the `@sim/*` packages — so the packaged app has **no runtime node_modules** and `electron-builder` needs no lockfile/npmRebuild step (this is the deliberate workaround for Bun ↔ electron-builder friction; there is no `package-lock.json`).

## Auth model (read before touching auth)

- The app loads the hosted origin top-level; better-auth session cookies live in a persistent partition (`persist:sim`, per-origin for self-hosts). Email/password and verified-lenient providers (GitHub) sign in fully in-window.
- **Google / Microsoft / SSO cannot OAuth inside an embedded browser** (`disallowed_useragent`; UA spoofing is fingerprint-defeated — do not ship it). Navigation to those hosts from an auth surface is intercepted and rerouted through the **system-browser handoff**:
  1. App starts a one-shot `127.0.0.1` loopback listener on an ephemeral port and opens `<origin>/desktop/auth?state=<random>&port=<port>` in the browser. The state is single-use, in-memory (the app is always running when the callback returns, so nothing is persisted), and constant-time compared.
  2. `apps/sim/app/desktop/auth/page.tsx` requires a browser session (redirects through `/login?callbackUrl=…`), mints a better-auth one-time token, and **redirects straight to the loopback** (`http://127.0.0.1:<port>/auth/callback?token=…&state=…`, RFC 8252 §7.3). This is the single hand-back channel — a deterministic server redirect, no OS scheme registration, no client-side step, works identically in dev and packaged builds. Interception of loopback is mitigated the way PKCE mitigates it: the token is single-use, short-TTL, and bound to a 128-bit state the app compares in constant time. (RFC 8252's *most*-preferred callback is claimed-`https` / macOS universal links, which bind the OS to a verified app identity — a future hardening step that needs an associated-domains entitlement + `apple-app-site-association` on the origin.)
  3. The loopback fires the callback in the main process: the app validates the state, then a renderer in the app partition POSTs the token to `/api/auth/one-time-token/verify` (same-origin ⇒ trustedOrigins/CSRF pass; better-auth sets the session cookie and burns the token) and loads `/workspace`.
- Integration connects are **same-window redirects** (`client.oauth2.link`), not popups. Unknown provider hosts stay in-window (lenient default); Google/Microsoft connects get a native dialog offering to finish in the browser — the browser is signed in after the login handoff, tokens land server-side, the app just refreshes.
- The MCP OAuth popup (`mcp-oauth-*`) is allowed as a same-partition child so `window.opener.postMessage` keeps working.
- Sign-out clears cookies/localStorage/IndexedDB/cache/service workers plus any pending handoff state. Two signals trigger it: the `/login?fromLogout=true` navigation (fast path) **and** deletion of the better-auth session cookie confirmed by a `get-session` probe (robust backstop — catches every sign-out path, not just the settings one, and rotation can't cause a false teardown). API 401s (probe-confirmed) surface a native re-auth prompt.

Deviations from the original plan doc (deliberate):
- **One hand-back channel, not two.** The plan proposed a `sim://` deep link with a loopback fallback; that was collapsed to loopback-only. The app is always running when the callback returns (it started the loopback), so the custom scheme added complexity and a dev-only failure mode without buying anything — loopback works identically everywhere. No `sim://` scheme is registered.
- No launch-time session probe; the server's own redirect to `/login` covers the signed-out launch, and the last route is restored otherwise.
- Browser-initiated `/desktop/auth` visits without a valid `state`+`port` render a friendly error and never mint a token.

## Provider matrix (U5 spike — keep current)

Host lists live in `src/main/navigation.ts` (`SYSTEM_BROWSER_IDP_HOSTS`, `IN_WINDOW_IDP_HOSTS`). Verified so far: Google + Microsoft blocked (by policy, not spike); GitHub assumed lenient. **Before GA, run the spike**: GitHub sign-in, consumer-Microsoft, a sample of integration connects (Notion, Slack, Linear, Atlassian, Box, Dropbox), SSO, and Turnstile-on-signup in a packaged build, then update the lists and this section.

## Web-app coupling contract (audit on web-app changes)

A thin shell over a hosted web app unavoidably knows a few of the web app's conventions. They are listed here so a web-app change that would break the desktop app is auditable in one place. Each is a documented, deliberate coupling — not accidental. The robust long-term de-coupling for all of them is a two-way preload bridge (see "Desktop-only features" below): the web app signals intent (`signalLogout()`, `markAuthSurface()`) instead of the shell inferring it.

| Shell code | Depends on | Breaks if the web app… | Failure mode | Mitigation today |
|---|---|---|---|---|
| `session-lifecycle.ts` `isLogoutNavigation` | `/login?fromLogout=true` on sign-out | renames the param/route | fast-path teardown misses | **Cookie backstop** (session-cookie deletion + probe) still tears down — no residue |
| `session-lifecycle.ts` `isSessionCookieName` | better-auth cookie ends `session_token` | changes the cookie name/prefix | backstop misses (fast path still works for settings sign-out) | better-auth library contract; stable. Revisit on better-auth major |
| `navigation.ts` `AUTH_SURFACE_PREFIXES` | auth routes `/login /signup /sso /reset-password /verify` | adds/renames an auth route | SSO from the new route gets the connect dialog instead of login | Update the list; unknown hosts from non-auth pages still default sensibly |
| `navigation.ts` IdP host lists | provider OAuth hostnames + embedded-UA policy | a provider changes hostnames/policy | that provider's sign-in/connect misroutes until a new release | Ships with the app; the U5 spike + upgrade checklist re-verify. Server-delivered config is the future fix |
| `session-lifecycle.ts` / `handoff.ts` `/workspace` default | `/workspace` is the post-login home | changes the default landing route | post-login/last-route restore lands on a redirect/404 | Web app's own routing usually redirects; low blast radius |
| `navigation.ts` `mcp-oauth-*` frame name | `hooks/queries/mcp.ts` opens `mcp-oauth-${id}` | renames the popup frame | MCP popup treated as generic → opener lost, flow hangs | String contract; add a shared constant if it churns |
| `window.ts` theme probe | `document.documentElement.classList.contains('dark')` (next-themes `attribute='class'`) | drops the `dark` class convention | pre-paint background may flash once | Cosmetic only; self-corrects on next load |
| `handoff.ts` redeem | `POST /api/auth/one-time-token/verify` sets the cookie | better-auth changes the endpoint | handoff sign-in fails | better-auth built-in endpoint; pinned by the `better-auth` version |

Overall this is **within normal thin-wrapper coupling** — every item is either backstopped (sign-out), cosmetic (theme), or a stable library/route contract. The only one that genuinely can't self-heal without a release is the IdP host list, which is inherent to the "pin Chromium, ship a binary" model and is managed by the upgrade program.

## Packaging & release

Local unsigned build: `bun run package:dir` (app in `release/mac-universal/`). Signed: `bun run package:mac` with `CSC_LINK`/`CSC_KEY_PASSWORD` exported.

Pre-release share (no Developer ID yet): `SIM_DESKTOP_DEFAULT_ORIGIN=https://www.dev.sim.ai bun run package:share` builds a DMG whose fresh installs default to that origin (baked at build time; official builds leave it unset → prod) and skips per-file signature timestamps. Recipients must clear quarantine once: `xattr -cr /Applications/Sim.app`.

CI (`.github/workflows/desktop-release.yml`, wired into `ci.yml`):
- Runs only after `create-release` on a `vX.Y.Z:` commit to main — **never before**: `scripts/create-single-release.ts` skips creation if the tag exists, so a desktop job publishing first would eat the changelog. The job builds `--publish never` and uploads assets with `gh release upload --clobber` (idempotent re-runs).
- **Secrets gate**: `check-desktop-signing` in `ci.yml` probes the six Apple secrets and skips the desktop job with a warning until they exist — releases never fail on a missing Apple account, and the first release after the secrets land ships desktop artifacts automatically. Manual/one-off builds: Actions → "Desktop Release (macOS)" → Run workflow with a `vX.Y.Z` version (`publish: false` uploads artifacts to the run instead of the release).
- The product semver is **injected** from the release tag into `apps/desktop/package.json` at build time (repo package versions are placeholders). A mismatch guard fails the build.
- Fuses are flipped at package time (`electronFuses` in `electron-builder.yml`): runAsNode off, NODE_OPTIONS off, inspect args off, ASAR-only + integrity validation, cookie encryption on, `strictlyRequireAllFuses` so new fuses fail loudly on Electron bumps.
- **Cookie-encryption go/no-go**: on every Electron bump, verify a packaged build keeps its session across relaunch (there are historical cookie-persistence bugs with the `EnableCookieEncryption` fuse). If it reproduces, set `enableCookieEncryption: false` and record it here.

Required repo secrets (owner: whoever holds the Apple Developer account; calendar the expiries — an expired cert/API key breaks every release):

| Secret | Contents |
|---|---|
| `CSC_LINK` | base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | `.p12` password |
| `APPLE_API_KEY_P8` | App Store Connect API key file contents (`.p8`) |
| `APPLE_API_KEY_ID` | API key ID |
| `APPLE_API_ISSUER` | API issuer ID |
| `APPLE_TEAM_ID` | Developer team ID |

## Desktop-only features (how to add them cleanly)

Yes — the architecture has a single, clean seam for native features, and nothing about "the renderer is the hosted web app" gets in the way. The rules:

1. **One bridge.** The preload (`src/preload/index.ts`) exposes `window.simDesktop` via `contextBridge` on the main window. This is the *only* channel between web content and native capability. It exposes narrow, typed methods — never raw `ipcRenderer` (Electron security checklist item 20).
2. **Feature-detect, never assume.** The same web app is served to browsers and to the desktop from one origin, so a desktop feature is progressive enhancement: `if (window.simDesktop) { … }`. In a browser `window.simDesktop` is `undefined` and the feature is simply absent. (`isHosted` already tags these sessions for analytics.)
3. **Gate in main.** Every channel is validated in `src/main/ipc.ts` by sender frame — app-origin for capability calls, bundled `file:` pages for shell-control calls (checklist item 17). A new native feature adds one gated channel there.
4. **Single-source the contract.** `apps/sim` cannot import from `apps/desktop` (monorepo rule: `apps/* → packages/*` only). The bridge interface lives in the shared types-only `packages/desktop-bridge` package, which both the preload and web app consume.

Concrete example — a "Reveal in Finder" button:

```ts
// packages/desktop-bridge/index.ts  (shared contract)
export interface SimDesktopApi { showItemInFolder(path: string): void /* …existing methods… */ }

// apps/desktop/src/preload/index.ts   (implement)
showItemInFolder: (path: string) => ipcRenderer.send('desktop:show-item', path),

// apps/desktop/src/main/ipc.ts        (gate)
ipcMain.on('desktop:show-item', (event, path) => {
  if (!isAppOriginSender(event, deps.appOrigin()) || typeof path !== 'string') return
  shell.showItemInFolder(path)
})

// apps/sim  (consume — progressive enhancement)
const desktop = useDesktop()
{desktop && <Button onClick={() => desktop.showItemInFolder(file.path)}>Reveal in Finder</Button>}
```

Good fits for the bridge: OS notifications + dock badge on workflow completion, global shortcuts, "reveal in Finder", tray, secure OS-keychain storage. Anything that touches the server/DB still goes through normal APIs — the bridge is only for **native** capability. This same bridge is also the robust way to retire the web-app couplings in the table above: have the web app *tell* the shell (`signalLogout()`, `markAuthSurface()`) instead of the shell inferring from URLs.

### Local filesystem access

Copilot can inspect user-selected local directories through the ordinary VFS tools. Granted folders appear beneath the top-level `user-local/` namespace, and `glob`, `grep`, and `read` are routed to Electron only when their path/pattern is explicitly scoped there. This capability is:

- **Explicit and read-only:** only a user click may open the native folder picker or revoke a grant; model tool calls cannot do either. There are no write/delete/execute/upload operations.
- **Remembered securely:** grants are encrypted in Electron's private app data with OS-backed `safeStorage` and restored with the same opaque URI after a normal app restart. (A security-scoped bookmark is stored alongside each grant, but it is a no-op in the current Developer ID build — only the macOS App Sandbox consumes it — and is kept purely for forward-compatibility should a sandboxed/MAS build ever ship.) There is no plaintext fallback: when secure storage is unavailable, the returned mount has `remembered: false` and lasts only for that app session.
- **Revocable:** Desktop settings removes one grant. All grants are removed on explicit sign-out or server-origin change so another Sim account or server cannot inherit them. Normal app quit only releases active OS handles and keeps the encrypted grants.
- **Opaque:** the model sees canonical paths such as `user-local/Project--<mount-id>/README.md`, never host paths or internal `localfs://` URIs. Electron resolves every request, checks lexical and realpath containment, and refuses symlink escapes.
- **Desktop-only:** the web app advertises `desktopCapabilities.localFilesystem` only when the Electron bridge is present. Mothership adds the `user-local/` prompt surface and per-call client routing only for that capability, including delegated and resumed work.
- **Bound to a live Copilot call:** before a native read/search or browser action, Electron asks the authenticated Sim origin for the pending tool-call record. Local requests must exactly match its persisted operation, path, and options; browser actions run with the persisted arguments rather than renderer-supplied ones. Completed, failed, and aborted runs are rejected.
- **Abort-aware and bounded:** stop/cancel propagates to active native scans and reads. File size, aggregate grep bytes, line, result, traversal-depth, and scan-count limits remain enforced in Electron, and unsafe regular expressions are rejected before execution.

Raw local file bytes are never exposed through the preload bridge and cannot be staged or uploaded by a model. Bounded text read/search results are returned to the active Copilot request; a user must use the normal attachment UI when they want the file itself to leave the device.

## Auto-update, channels, rollout, rollback

- `electron-updater` reads the GitHub Releases feed (`publish` is pinned to `simstudioai/sim`); deltas via `.zip.blockmap`. Install is prompt-based (Restart Now / Later; Later installs on quit) — never forced mid-session.
- Channels: stable builds (`X.Y.Z`) follow `latest`; `-beta.N` builds follow `beta` (never attach a beta `latest-mac.yml` to a stable tag).
- Staged rollout: after publishing, edit `stagingPercentage: 10` into the release's `latest-mac.yml`, then raise as crash metrics stay clean.
- Rollback: a pulled release must be superseded by a **higher** version — users on the broken build will not reinstall an equal one. (A blocked-versions kill-switch was removed as unwired dead code; reintroduce it in `updater.ts` if a remote config source ever exists to feed it.)
- Ship the DMG and tell users to install to `/Applications` — App Translocation breaks Squirrel.Mac updates from quarantined paths.

## Self-hosting

- Point Settings… (`Cmd+,`) at your instance. HTTPS required (HTTP for localhost only); each origin gets an isolated cookie partition.
- Deploy the `/desktop/auth` page (ships with `apps/sim`) and include your desktop users' origin in `TRUSTED_ORIGINS` if it differs from `NEXT_PUBLIC_APP_URL`.
- TLS must be **system-trusted** — the shell hard-rejects certificate errors (no in-app bypass). Install private CA roots in the macOS keychain.
- `DISABLE_AUTH` instances: the web app serves an anonymous session; the shell needs no special handling, but understand that anyone with the app and your origin has full access.
- Forks: repoint `publish.owner/repo` in `electron-builder.yml` or strip the updater.

## Known caveats

- Voice STT requires the microphone TCC prompt (wired; `NSMicrophoneUsageDescription` + `device.audio-input` entitlement). Camera stays denied by design.
- Default Electron ships H.264/AAC/MP3 — do not swap in the codec-free ffmpeg build.
- Web Speech **recognition** (`SpeechRecognition`) does not exist in Electron; Sim does not use it (voice goes through `getUserMedia` + server STT).
- Third-party web analytics (GTM/GA) are blocked at the network layer by default (`blockThirdPartyAnalytics`); first-party PostHog `/ingest` is untouched.
- `Cmd+F` find-in-page overlay is not implemented (Monaco and tables ship their own finds); revisit if users ask.
- Sign-in uses only the `127.0.0.1` loopback callback, which needs no OS registration — so it completes identically under `bun run dev` (unpackaged) and in a packaged build. There is no custom URL scheme.

## Electron upgrades

Cadence: Electron ships a major every ~8 weeks and supports the latest 3 — budget a bump every ~4–6 months and adopt security patches within ~2 weeks. Follow `docs/electron-upgrade-checklist.md`; the `desktop-e2e.yml` canary leg (electron@latest) is the early-warning signal.
