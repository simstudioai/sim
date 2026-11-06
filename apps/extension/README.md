# Sim browser extension

The Chrome extension attaches an explicitly captured page or selection to the existing Sim chat. The native side panel hosts the authenticated `/extension` app surface. Chat opens in the user's organization when available; choosing a workspace is optional. Members without access to Home use the organization's Assistant. Chat rendering, execution, permissions, billing, and history belong to Sim and Mothership.

[User and administrator guide](https://docs.sim.ai/browser-extension)

The keyboard shortcut prefers highlighted text and preserves the draft when a selection cannot be read. Chrome’s **Extensions → Keyboard shortcuts** page controls the binding per profile. A link’s context menu opens the existing Links creation form with a reviewed destination; only selecting **Create** writes a link.

## Build and load

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd apps/extension build
```

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`. Copy the extension ID into the Sim server's `BROWSER_EXTENSION_IDS` configuration. It accepts comma-separated Chrome extension IDs. Restart the app after changing that configuration. Unconfigured IDs cannot embed the app.

Click the Sim toolbar icon to open chat and attach the current page. **+ → Current page** adds a fresh snapshot; **Selected text** attaches the highlighted passage. Attachments appear as chips inside the composer. Attach pages or selections to summarize, extract facts, or compare sources. To quote a passage, select it and choose **Ask Sim about selection** from the context menu. Review or remove the attachment before sending. **+ → Page access** offers **Allow across websites**. Approve the browser prompt once to use pages across HTTP and HTTPS sites without per-site setup. Manage access in the browser’s extension settings. Permission alone never enables background capture.

For local development:

```sh
SIM_EXTENSION_DEV=1 SIM_EXTENSION_ORIGIN=http://localhost:3000 bun run --cwd apps/extension build
```

`SIM_EXTENSION_ORIGIN` is baked into the package. Production builds require an HTTPS origin. Explicit development builds may use HTTP on loopback. `SIM_EXTENSION_KEY` optionally supplies the public manifest key for a stable extension ID; never supply a private signing key. Chrome Web Store signing and publisher credentials stay outside this repository.

## Data and permissions

- Required capabilities: `activeTab`, `scripting`, `sidePanel`, `storage`, `contextMenus`, `declarativeNetRequestWithHostAccess`, and access to the configured Sim origin and to `http(s)://sim/*` and `http(s)://go/*`.
- Type `sim`, press Space, enter the name, and press Enter to open an organization's [link](https://docs.sim.ai/search/sim-links). `go/<name>` opens the same link. Chrome treats bare `go/<name>` or `sim/<name>` as a search until its history holds that short host, so on install, and at browser start once a week, the extension opens `http://go/` and `http://sim/` in background tabs that close themselves. It does this only once Sim says links are on for the signed-in session, so `go/x` stays an ordinary search for everyone else; signing in through the side panel checks again. Chrome counts a visit to an unfamiliar single-label host as typed, which is what the address bar checks, and repeating covers history that expires after 90 days or is cleared. A trailing slash (`go/<name>/`) always selects navigation. A single static redirect rule rewrites top-level navigations to `http(s)://sim/*` and `http(s)://go/*` to `<Sim origin>/sim/*` with the path and query unchanged. The `sim` and `go` host permissions exist only for that rule: every navigation to those hosts is redirected before it loads, and no other request is matched or observed. An organization that already serves an intranet host named `sim` or `go` should not install this build, since its links would be redirected to Sim. When another extension (such as another go-links tool) also redirects `go/`, Chrome applies the most recently installed extension's rule.
- The `sim` address-bar keyword (`sim`, then Space) lists matching Sim links while you type and opens what you enter through the same resolver. For these suggestions, the background worker sends the text typed before the first `/` or `?`, and nothing else, unless that text contains a space (a search) or is longer than a link name can be, to `<Sim origin>/api/sim-links/suggestions` with the signed-in session, and the extension's content security policy allows connections to that origin alone. Unlisted links are never suggested.
- Optional HTTP/HTTPS access is requested together by **Allow across websites**, from a direct user action. Chrome's `activeTab` access is temporary and does not follow arbitrary new sites.
- Page capture runs on demand in Chrome's isolated world. It excludes editable fields, inputs, hidden elements, scripts, and embedded documents. It reads only the top frame. PDF viewers and canvas documents may have no accessible text.
- Extraction stops at 50,000 text characters, 150,000 serialized UTF-8 bytes, 15,000 visited nodes, or 150ms. The composer exposes truncation.
- Attached pages share a 150,000-character and 450,000-byte snapshot budget per message, within the general 100-context ceiling. Shorter pages can share the available budget without a separate page-count restriction.
- Source URLs omit credentials, query parameters, and fragments. Human-readable text can still contain sensitive information; it is the user-selected material they review and send into their conversation.
- Snapshots stay in memory until handed to Sim and acknowledged or expired after 30 seconds. For captures, extension storage contains only a short-lived intent with a tab/document identity and a SHA-256 URL digest, never raw URLs, captured text, or credentials. Closing a tab or navigating invalidates its pending intent. Sim applies its normal conversation retention once a message is sent.
- No browser history permission, bookmarks, cookie access, debugger access, remote extension JavaScript, arbitrary network proxy, or background content collection is requested. Incognito use is disabled.
- The iframe bridge checks both the exact configured origin and the exact frame, then validates versioned messages. The hosted composer may request only page capture, selection capture, the native page-access dialog, or the browser's fixed microphone settings page. Requests require the current conversation nonce and Chrome transient user activation; arbitrary URLs, tabs, script execution, and network operations are never accepted. Permission grants still require a click in the extension-owned page-access control and browser approval.
- Captures and queued toolbar intents are scoped to the receiving conversation. Changing conversation, workspace, or account discards an unfinished handoff. Captured attachments remain explicit snapshots when the source tab changes.
- The complete hosted document, including portaled source dialogs and menus, is blocked from session replay. Clipboard writing and microphone capture are delegated only to the configured Sim origin; clipboard reading and camera access are not delegated. Voice input starts only after the user clicks the microphone and the browser grants permission. The shared Sim voice service streams microphone audio to ElevenLabs for transcription into the editable draft. Stop ends capture while allowing the final transcript to arrive; Send and conversation changes cancel unfinished transcription. There is no tab-audio capture or background recording.

With **Reference current page** enabled, a composer Send requests a single fresh snapshot for that conversation. Local storage holds only this preference and when the short hosts were last visited. A tab change does not read any content. Explicit snapshots take precedence; access denial, navigation and timeouts keep the draft unsent. **Allow across websites** works even when Chrome hides the active address; no address entry is required. The grant covers HTTP and HTTPS sites across tabs until the user revokes or restricts it in browser settings. Uploaded screenshot files stay in the hosted app’s normal attachment flow.

## Verification

```sh
bun run --cwd apps/extension type-check
EXTENSION_REPORT_PATH=test-results/extension-report.json bun run --cwd apps/extension test:e2e
bun run --cwd apps/extension build
```

The E2E suite uses real Chromium, the packaged extension, and a disposable HTTP app fixture. It pregrants only the fixture page origin in a temporary package to exercise extraction without automating the browser's permission dialog. It checks HttpOnly session-cookie transport, origin/frame spoofing, sensitive-field exclusion, source URL minimization, selected excerpts, UTF-8 limits, stale-document handoffs, denied host access, and absence of page bytes in extension storage. The cookie check uses a fixture, not Better Auth or SSO. JSON results and a screenshot are written beside the caller-supplied report path. The E2E suite builds into a temporary directory and leaves shipping `dist` untouched.

Release verification must additionally exercise typing `go/<name>` in Chrome's real address bar on a clean profile (the e2e proves the visits, not the address bar), the native toolbar and shortcut, Chrome's real grant/revoke prompt, sign-in/SSO and expiry against the running Sim app, side-panel closing/reopening, workspace changes, narrow widths, and the real Mothership streaming response. The fixture suite does not establish those integrations. The design document records launch scope and release criteria.

The authenticated acceptance suite runs against a real local app, Better Auth, and a disposable Postgres database whose name contains `test`. Enable `KNOWLEDGE_MEMBER_ACCESS`, `CREDENTIAL_GROUPS`, `ACCESS_CONTROL_ENABLED`, and `NEXT_PUBLIC_ACCESS_CONTROL_ENABLED` on that app to exercise restricted organization members:

```sh
EXTENSION_APP_E2E_BASE_URL=http://127.0.0.1:3007 \
EXTENSION_APP_E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/extension_test \
EXTENSION_APP_E2E_REPORT_PATH=../extension/test-results/real-app-report.json \
SIM_EXTENSION_KEY="$PUBLIC_EXTENSION_KEY" \
bun run --cwd apps/sim test:browser-extension:e2e
```

Configure the matching extension ID in the running app. The suite builds into a temporary directory, creates its own accounts/workspaces, and removes them afterward; it leaves the shipping `dist` untouched. It verifies real authentication, workspace denial, page limits, navigation, source links, clipboard writes, actual replay-recorder exclusion, themes, widths, and sign-out. CI provisions this isolated environment in the shared HTTP acceptance matrix, using the same production build as the other app suites. The packaged extension transport suite runs separately. Set `EXTENSION_APP_E2E_LIVE_CHAT=1` when the app is connected to a working local Mothership instance to additionally verify live rendering, saved page context, queue editing, and drafts through chat admission. Provider credentials belong only in that server's environment. Reports and screenshots are written beside the supplied report path. Native toolbar/shortcut/context-menu and permission-prompt checks remain manual release checks.

## Distribution

Publish only the production contents of `dist`, after rebuilding against the deployed Sim origin and configuring the issued store extension ID on that server. The store listing and privacy disclosure must describe that page text is sent to Sim when attached and used in a conversation, and link to the applicable Sim privacy policy. Keep the publisher account protected with hardware-backed MFA and limited release access.

Research: [Chrome extension security](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [Manifest V3 policies](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements), and [OWASP extension vulnerabilities](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html).
