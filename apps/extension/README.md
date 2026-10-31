# Sim browser extension

The Chrome extension attaches an explicitly captured page or selection to the existing Sim chat. The native side panel hosts the authenticated `/extension` app surface. Chat opens in the user's organization when available; choosing a workspace is optional. Members without access to Home use the organization's Assistant. Chat rendering, execution, permissions, billing, and history belong to Sim and Mothership.

## Build and load

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd apps/extension build
```

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`. Copy the extension ID into the Sim server's `BROWSER_EXTENSION_IDS` configuration. It accepts comma-separated Chrome extension IDs. Restart the app after changing that configuration. Unconfigured IDs cannot embed the app.

Click the Sim toolbar icon to open chat and attach the current page. **+ → Current page** adds a fresh snapshot; **Selected text** attaches the highlighted passage. Attachments appear as chips inside the composer. Attach up to three pages or selections to summarize, extract facts, or compare sources. To quote a passage, select it and choose **Ask Sim about selection** from the context menu. Review or remove the attachment before sending. **+ → Site access** opens the extension-owned permission dialog: **Allow access to [site]** grants access only to that site; **Remove access to [site]** revokes it. Persistent site permission never enables background capture.

For local development:

```sh
SIM_EXTENSION_DEV=1 SIM_EXTENSION_ORIGIN=http://localhost:3000 bun run --cwd apps/extension build
```

`SIM_EXTENSION_ORIGIN` is baked into the package. Production builds require an HTTPS origin. Explicit development builds may use HTTP on loopback. `SIM_EXTENSION_KEY` optionally supplies the public manifest key for a stable extension ID; never supply a private signing key. Chrome Web Store signing and publisher credentials stay outside this repository.

## Data and permissions

- Required capabilities: `activeTab`, `scripting`, `sidePanel`, `storage`, `contextMenus`, `declarativeNetRequestWithHostAccess`, and access to the configured Sim origin and to `http(s)://sim/*`.
- Typing `sim/<name>` in the address bar opens the organization's [Sim link](https://docs.sim.ai/search/sim-links). A single static redirect rule rewrites top-level navigations to `http(s)://sim/*` to `<Sim origin>/sim/*` with the path and query unchanged. The `sim` host permission exists only for that rule: every navigation to that host is redirected before it loads, and no other request is matched or observed. An organization that already serves an intranet host named `sim` should not install this build, since its links would be redirected to Sim.
- The `sim` address-bar keyword (`sim`, then Space) lists matching Sim links while you type and opens what you enter through the same resolver. It is the extension's only network request: the background worker sends the typed text, and nothing else, to `<Sim origin>/api/sim-links/suggestions` with the signed-in session, and the extension's content security policy allows connections to that origin alone. Unlisted links are never suggested.
- Optional HTTP/HTTPS site access is requested only by a menu action naming that site. Chrome's `activeTab` access is temporary and does not follow arbitrary new sites.
- Page capture runs on demand in Chrome's isolated world. It excludes editable fields, inputs, hidden elements, scripts, and embedded documents. It reads only the top frame. PDF viewers and canvas documents may have no accessible text.
- Extraction stops at 50,000 text characters, 150,000 serialized UTF-8 bytes, 15,000 visited nodes, or 150ms. The composer exposes truncation.
- Source URLs omit credentials, query parameters, and fragments. Human-readable text can still contain sensitive information; it is the user-selected material they review and send into their conversation.
- Snapshots stay in memory until handed to Sim and acknowledged or expired after 30 seconds. Extension storage contains only a short-lived intent with a tab/document identity and a SHA-256 URL digest, never raw URLs, captured text, or credentials. Closing a tab or navigating invalidates its pending intent. Sim applies its normal conversation retention once a message is sent.
- No browser history, bookmarks, cookie access, debugger access, remote extension JavaScript, arbitrary network proxy, or background content collection is requested. Incognito use is disabled.
- The iframe bridge checks both the exact configured origin and the exact frame, then validates versioned messages. The hosted composer may request only page capture, selection capture, or the native site-access dialog. Requests require the current conversation nonce and Chrome transient user activation; arbitrary URLs, tabs, script execution, and network operations are never accepted. Permission grants still require a click in the extension-owned dialog.
- Captures and queued toolbar intents are scoped to the receiving conversation. Changing conversation, workspace, or account discards an unfinished handoff. Captured attachments remain explicit snapshots when the source tab changes.
- The complete hosted document, including portaled source dialogs and menus, is blocked from session replay. Clipboard writing is delegated only to the configured Sim origin. Clipboard reading and microphone capture are not delegated; voice input remains available in the main app.

## Verification

```sh
bun run --cwd apps/extension type-check
EXTENSION_REPORT_PATH=test-results/extension-report.json bun run --cwd apps/extension test:e2e
bun run --cwd apps/extension build
```

The E2E suite uses real Chromium, the packaged extension, and a disposable HTTP app fixture. It pregrants only the fixture page origin in a temporary package to exercise extraction without automating the browser's permission dialog. It checks HttpOnly session-cookie transport, origin/frame spoofing, sensitive-field exclusion, source URL minimization, selected excerpts, UTF-8 limits, stale-document handoffs, denied host access, and absence of page bytes in extension storage. The cookie check uses a fixture, not Better Auth or SSO. JSON results and a screenshot are written beside the caller-supplied report path. The E2E suite builds into a temporary directory and leaves shipping `dist` untouched.

Release verification must additionally exercise the native toolbar and shortcut, Chrome's real grant/revoke prompt, sign-in/SSO and expiry against the running Sim app, side-panel closing/reopening, workspace changes, narrow widths, and the real Mothership streaming response. The fixture suite does not establish those integrations. The design document records launch scope and release criteria.

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
