# Sim browser extension

Implementation scope and research, 2026-10-29.

## Product contract

The extension is another surface of Sim. A native Chrome side panel hosts the actual
Sim composer and transcript, using existing authenticated Mothership requests,
conversation persistence, streaming recovery, model controls, tool permissions,
and workspace authorization. A conversation can continue in the full app.

The user signs in in a normal Sim tab, chooses a workspace, opens or creates a
conversation, and explicitly attaches the current page or highlighted text.
The composer’s + menu offers Current page and Selected text. Pending snapshots sit
inside the composer as compact removable chips alongside file attachments. Opening one
shows the captured text, source, capture time, and conversation-retention disclosure.
Partial captures remain labeled in the attachment row. Site access lives in the
composer’s Site access action, which opens an extension-owned dialog; successful delivery adds no persistent status banner.
They are immutable: navigating to another page cannot silently change an attached
source. Removing an attachment, changing workspace, or starting a new conversation
clears pending page context. Several explicitly attached pages can support comparison.
Assistant accepts page snapshots while retaining its existing restriction on
workspace-resource contexts.

The extension does not promise complete capture of virtualized documents, canvas
editors, restricted browser pages, inaccessible cross-origin frames, or PDFs.
Extraction failure is visible; the model must never infer absent page content.
Browser interaction, autonomous navigation, screenshot OCR, and native-app control
are separate capabilities requiring their own permission and execution contracts.
Existing Sim server tools remain subject to their existing authorization and approval.

## Ownership and data flow

1. `apps/extension`: packaged MV3 service worker, side-panel host, bounded content
   extraction, per-site permission controls, build artifacts, browser verification.
2. `packages/browser-extension-protocol`: versioned, strictly validated messages and
   immutable page snapshots shared by the extension, app, and server.
3. `apps/sim/app/extension`: session gate, workspace picker, minimal app providers,
   real chat components, history and a narrow parent-window bridge.
4. Existing chat context pipeline: `browser_page` input validation, durable message
   projection, restored context chips, untrusted-content formatting, Assistant admission.
5. Existing Sim API and Mothership: authentication, authorization, billing, tool
   execution and streaming; no alternate inference service or extension API key.

The content script returns text to its extension caller. The extension verifies the
captured document still belongs to the intended tab, then sends a typed snapshot to
the exact hosted frame. The frame validates its parent origin and identity, and puts
the snapshot into pending UI context. The existing send path persists it with the
message and passes quoted content to Mothership. A page snapshot grants no access to
other workspace resources or browser-control tools.

## Permission and lifetime rules

- Required browser capabilities: side panel, scripting, active tab, context menus,
  and short-lived session storage for selection handoff. Required host access is
  limited to the configured Sim origin.
- Other HTTP(S) origins are optional grants requested for the current site from a
  user gesture. Each grant can be revoked. Keeping the panel open is not a grant
  to read every subsequently selected tab.
- No history, bookmarks, cookie API, debugger, network interception, native
  messaging, external messaging, or arbitrary remote code execution.
- No always-running page reader. Extraction is tied to an explicit attachment action.
- Page bytes are not written to extension local/sync storage. Temporary context-menu
  handoff uses trusted-context session storage, expiration and navigation cleanup.
- Sent snapshots become chat data and follow Sim's chat retention and deletion
  policy. This must be disclosed in the interface and store listing. No claim of
  zero retention is made once a message is sent.
- No page content or full page URL in extension telemetry or routine logs.

## Boundary controls

- Package all privileged JavaScript. The hosted iframe has no extension API access.
- Only exact configured Sim origins and exact configured extension IDs are trusted.
  Both directions validate source window, origin, protocol version and message shape.
  There is no arbitrary fetch, JavaScript, navigation or extension-API command bridge.
- `BROWSER_EXTENSION_IDS` is a bounded comma-separated list of Chrome IDs. Missing
  or malformed configuration disables embedding. Only `/extension` and its children
  receive the corresponding frame policy; ordinary app pages keep their frame denial.
- Extension pages use a restrictive CSP; the hosted app keeps its app CSP with only
  the embedding ancestor list changed. Sign-in happens in a top-level tab.
- Allow HTTPS production app origins; HTTP is development-only on loopback.
- Capture uses bounded traversal and output size, skips hidden and editable/form
  content, and records truncation. It never serializes the entire DOM or reads
  cookies, browser storage, input values, or page-world JavaScript state.
- Validate snapshots again server-side, including headless execution paths. Bound
  individual and aggregate text/byte sizes. Only HTTP(S) source URLs without embedded
  credentials are accepted; URL secrets should not be carried as source metadata.
- Snapshot content is explicitly untrusted quoted JSON. This is a model cue, not
  an authorization mechanism: tool access remains independently enforced by Sim.

## Verification planned before implementation

The credible failure modes are cross-origin/frame message forgery; schema-version
confusion; hostile URL metadata; hidden/form data leakage; unbounded DOM traversal;
selection or extraction delivered after navigation; stale context on workspace
switch; persistence mutating the captured text; Assistant silently dropping context;
and an embed exception accidentally allowing unrelated app pages to be framed.

Use a real Chromium extension against controlled HTTP pages for extraction,
navigation, permission and message-boundary checks. Emit a caller-configured JSON
report and screenshot/trace artifacts. Security-boundary tests may cover header
isolation and durable-context semantics where the running app needs unavailable
services. Do not replace real Chrome APIs with mocks and describe that as E2E.

The authenticated live-app acceptance gate is: sign in, choose a permitted workspace,
capture a real page, receive a grounded Mothership answer, reopen the conversation,
stop/reconnect streaming, switch workspaces, and verify access denial. An absent
backend or account is an unverified gate, not a pass.

## Research and decisions

- [Glean sidebar](https://docs.glean.com/user-guide/apps/extension-sidebar) and
  [page permissions](https://docs.glean.com/user-guide/apps/why-does-the-chrome-extension-ask-for-those-permissions):
  page context can use address and text without indexing the page. Adopt explicit
  page attachment alongside the existing Sim knowledge and tool experience.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
  and [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions):
  temporary access follows user invocation; cross-origin navigation requires fresh
  authority. Request persistent access per site only when selected by the user.
- [Chrome extension security](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
  and [OWASP extension guidance](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html):
  minimize privileges and treat all incoming page messages as attacker-controlled.
  Do not expose a generic privileged bridge.
- [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle):
  workers are disposable. Stream from the app document; bound temporary handoffs
  independently of worker globals.
- [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies):
  extension frames have special partition and cookie behavior. Reuse Sim sessions,
  verify enterprise policy and blocked-cookie cases, and show a top-level sign-in
  recovery path instead of copying credentials into extension storage.
- [MV3 remote-code policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements):
  isolated remote frames are permitted subject to review and user-data rules. All
  privileged capture and message logic remains packaged and inspectable.
- [User-data disclosures](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq):
  local processing of website content still requires disclosure. Publish actual
  data handling and permission justifications with the store submission.

## Release scope and remaining expansion

Planning estimate for one engineer familiar with Sim: 5–8 engineering days for
the core surface, context pipeline and security boundaries; 2–4 more days for
authenticated deployment QA, enterprise cookie-policy checks and release packaging.
These are estimates for production readiness, not a promise that a working local
build has completed those gates. Chrome Web Store review is an external timeline.
Richer document adapters and screenshot capture are roughly another 1–2 weeks;
autonomous browser actions need a separate design and estimate.

The first implementation targets Chrome MV3 and a configured Sim deployment. It
includes the shared chat UI and engine, explicit page/selection context, Assistant
context support, workspace/history navigation, permission controls and verification.
It does not constitute store publication or proof of every third-party site's DOM.

Follow-on work: screenshot/image attachment through existing authorized upload paths;
document-specific adapters with measured coverage; Firefox/Safari shells; managed
enterprise distribution; and separately authorized browser-action tools. Each must
retain the same source, identity, consent and lifecycle boundaries.
