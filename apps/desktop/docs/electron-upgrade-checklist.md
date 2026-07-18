# Electron upgrade checklist

The rendering-parity guarantee (identical to Chrome of the pinned version) is only durable if upgrades are routine. Run this list for every Electron major bump; the abridged list (steps 1, 2, 6, 8) for patch/security releases.

1. **Read the release notes.** Electron breaking-changes page for the target major, plus its Chromium/Node versions. Note anything touching: session/cookies, permissions, `setWindowOpenHandler`, `will-navigate`/`will-redirect`, preload/sandbox, `net`/loopback, fuses.
2. **Bump the pin** in `apps/desktop/package.json` (exact version), `bun install`, `bun run type-check && bun run test`.
3. **Fuses:** the build sets `strictlyRequireAllFuses` — if `electron-builder` fails on a new fuse, decide its state explicitly in `electron-builder.yml` rather than loosening the strict flag.
4. **Cookie-encryption go/no-go:** packaged build → sign in → quit → relaunch → still signed in. If the session is lost, flip `enableCookieEncryption: false`, file it in the README, and retest.
5. **Manual spot-checks (packaged build):**
   - Google sign-in via the system-browser handoff (127.0.0.1 loopback callback → token redeem).
   - GitHub sign-in in-window; one integration connect (e.g. Notion) in-window; one Google-family connect via the browser dialog.
   - MCP OAuth popup completes and posts back to the opener.
   - Voice input records (mic TCC prompt on a clean profile).
   - Workflow canvas (WebGL/ReactFlow), Monaco editing, a table export download.
   - Offline page appears with networking off; Retry recovers.
6. **E2E:** `bun run test:e2e` green locally on the new pin; `desktop-e2e.yml` green in CI (the `latest` canary leg should already have hinted at surprises).
7. **Signing/notarization smoke:** run `desktop-release.yml` via `workflow_dispatch` with `publish: false` against a test tag; `spctl`/`stapler` steps must pass.
8. **Ship** behind a staged rollout (10% `stagingPercentage`) and watch `update_error` / `renderer_gone` rates in the event logs before raising.
