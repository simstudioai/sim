# Sim browser extension

Implementation scope and research, 2026-10-29.

## Product contract

The extension is another surface of Sim. A native Chrome side panel hosts the actual
Sim composer and transcript, using existing authenticated Mothership requests,
conversation persistence, streaming recovery, tool permissions, and organization
or workspace authorization. The panel keeps Fast mode and omits the model selector.
A conversation can continue in the full app.

Voice input uses the existing microphone control beside Send. The browser asks for
microphone permission on first use. Transcription updates the editable draft and
never sends it automatically. Stop ends recording; Send and conversation changes
discard unfinished transcription. The iframe delegates microphone access only to
the configured Sim origin, and blocked access offers the browser's microphone settings.

The user signs in in a normal Sim tab and lands in their organization chat. Choosing
a workspace is optional; members without Build access use Assistant. They can open
or create a conversation and explicitly attach the current page or highlighted text.
The composer’s + menu offers Current page and Selected text. Pending snapshots sit
inside the composer as compact removable chips alongside file attachments. Opening one
shows the captured text, source, capture time, and conversation-retention disclosure.
Partial captures remain labeled in the attachment row. Page access lives in the
composer’s Page access action, which opens an extension-owned dialog; successful delivery adds no persistent status banner.
Snapshots are immutable: navigating to another page cannot silently change an attached
source. Removing an attachment, changing organization or workspace, or starting a new conversation
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
   extraction, browser-wide page permission setup, build artifacts, browser verification.
2. `packages/browser-extension-protocol`: versioned, strictly validated messages and
   immutable page snapshots shared by the extension, app, and server.
3. `apps/sim/app/extension`: session gate, organization landing, optional workspace picker, app providers,
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
  short-lived session storage for selection handoff, and local storage for preferences. Required host access is
  limited to the configured Sim origin and to `http(s)://sim/*` and `http(s)://go/*`, which exist
  only so one static redirect rule can send top-level navigations to those hosts to the link resolver.
- HTTP(S) page access is one optional browser-wide grant, requested from a direct
  user gesture. The browser owns revocation and restrictions. Approval enables
  capture across sites; switching tabs alone does not extract content.
- No history permission, bookmarks, cookie API, debugger, native messaging, external messaging,
  or arbitrary remote code execution. The only network interception is the static
  `sim/` and `go/` redirect rule above.
- Background network requests are limited to two. Once a week at browser start, and after
  signing in to the panel, the worker asks the Sim origin whether links are on for the session;
  if so, it opens `http://go/` and `http://sim/` in background tabs that close themselves, which
  teaches Chrome's address bar these hosts and adds entries to browser history. The other is the
  `sim` address-bar keyword: after
  `sim` and Space, the text typed before the first `/` or `?` is sent to the
  configured Sim origin with the signed-in session to suggest matching Sim links,
  unless it contains a space (a search) or is longer than a link name can be. Page
  content is never sent, and unlisted links are never suggested.
- Page extraction runs on an explicit attachment action or a user-initiated composer Send while Reference current page is enabled. The preference persists locally. Send-time captures are scoped to the request and conversation; navigation, denied access or timeout cancels the send.
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

The authenticated live-app acceptance gate covers organization chat, Assistant, and
permitted workspaces: capture a real page, receive a grounded Mothership answer,
reopen the conversation, stop/reconnect streaming, and switch scopes. Verify revoked
access, live policy changes, retained drafts, and late history reads after completion.
An absent backend or account is an unverified gate, not a pass.

## Research and decisions

- [Glean sidebar](https://docs.glean.com/user-guide/apps/extension-sidebar) and
  [page permissions](https://docs.glean.com/user-guide/apps/why-does-the-chrome-extension-ask-for-those-permissions):
  page context can use address and text without indexing the page. Adopt explicit
  page attachment alongside the existing Sim knowledge and tool experience.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
  and [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions):
  temporary access follows user invocation; cross-origin navigation requires fresh
  authority. Request optional access across HTTP(S) websites once, matching Glean’s all-websites page-context option.
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
context support, organization/workspace/history navigation, permission controls and verification.
It does not constitute store publication or proof of every third-party site's DOM.

Follow-on work: screenshot/image attachment through existing authorized upload paths;
document-specific adapters with measured coverage; Firefox/Safari shells; managed
enterprise distribution; and separately authorized browser-action tools. Each must
retain the same source, identity, consent and lifecycle boundaries.
