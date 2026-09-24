# Federated Search access and connector behavior

This describes the live enterprise-search path. Credential Groups and ordinary knowledge-base indexing retain their existing behavior. Live Search is enabled by default; only an explicit `SIM_SEARCH_LIVE=false` selects the legacy indexed backend. Live Search sources do not create content-indexing jobs, and queued content or persisted-directory jobs stop before crawling, embedding, or building ACL snapshots. Ordinary KB jobs remain enabled. Administrators can still maintain GitLab CSV grants, and request-time source permission checks remain required.

## Admin and member surfaces

- **Sources** controls integration availability and account mode per integration.
- **Member accounts** has no resource configuration. A member connects their own account under Integrations, and searches content that account can access through the provider API. Old member resource filters are ignored and cleared when settings are saved.
- **Service account** selects an admin-managed source. Its connection owns the resource settings; Sources does not duplicate them. GitHub uses one GitHub App source per repository instead of a single selected source. A member still connects their own account, except for GitLab. Search returns the intersection of the member's provider permissions and the source's current resource boundary.
- GitLab is always service-account mode. Slack and Jira currently support member mode only.
- Removing a source integration prevents subsequent account resolution, searches, and reads. Paused, archived, deleted, wrong-organization, wrong-provider, and unapproved service sources cannot authorize search.

The Search assistant exposes the dedicated search/read tools. It cannot discover or execute integration tools through `search_integration_tools`, `call_integration_tool`, or direct provider-tool names. The broader assistant outside Search retains its integration tools.

## Common request pipeline

1. Authorize the acting member against the canonical organization/workspace and resolve that member's current provider grant.
2. Load the integration's current mode and availability. In service mode, independently load and resolve the configured source credential within that organization.
3. Search the member's provider API or personal Coda MCP. Push resource restrictions into the provider query where supported to improve recall. Native queries may narrow these restrictions, but cannot override the independent checks.
4. In service mode, use the source credential to verify each candidate against the source's current permissions and resource settings. Content still comes from the member's connection. Drop candidates that cannot be verified before projecting titles, snippets, or citations to the assistant.
5. Bind document references to the member, owner scope, provider, and account. On a read, resolve access again, verify the source before reading, and check current source settings again before returning content. GitLab additionally validates ACLs against fresh content metadata.

Permission caches are local to a request. Provider failures and bounded/incomplete retrieval are reported as unavailable or partial; empty results do not prove that no matching documents exist. No vector index is consulted by this path.

## Connectors

### Google Drive

Member mode searches Drive with the member's OAuth token, including accessible Docs, Sheets, Slides, and supported files. Service mode uses a Google Workspace service account with domain-wide delegation. The connected identity is obtained from Drive; Directory verifies active users and the same Workspace customer before delegation.

For an explicit source user list, source-side verification tries those users' delegated tokens, with a six-user request cap. With all users selected, it delegates to the connected Workspace member. An external connected reader cannot be impersonated in that Workspace, so verification falls back to the verified source administrator and reports partial coverage. This does not enumerate every employee's private Drive.

The source credential must be able to read the file. Selected folders, accessible subfolders, shared-drive IDs, and file types are checked using source-side metadata. Folder queries narrow candidate retrieval; metadata verification remains authoritative. A member's personal file outside the configured source scope is excluded even if their OAuth token can read it. Folder expansion and ancestry traversal are bounded and may report partial coverage.

### Gmail

Member mode searches the connected mailbox using Gmail message search operators. Service mode requires Workspace delegation and verifies the connected mailbox's email through Gmail, then validates its active Directory identity/customer and any selected source user list. Delegation targets that same mailbox; it never substitutes another user's mailbox. The admin label picker browses the delegated administrator's mailbox but stores label names, since custom label IDs differ between mailboxes.

For a source configured with **Labels = INBOX**:

1. Search the member's Gmail connection with the user's query plus the INBOX label restriction and configured category exclusions.
2. Fetch each candidate's metadata under the source's delegated token for that member's mailbox.
3. Check the message's current `labelIds` against INBOX. Custom labels are resolved in that mailbox; labels may differ across users.
4. Apply the source's rolling date range, Promotions/Social exclusions, and custom Gmail query. A custom query is verified through a source-side message search restricted by the message's RFC Message-ID, followed by exact Gmail message-ID matching.
5. Return only verified messages. Reading a result fetches that individual message through the member's connection and rechecks the source boundary; it does not expose other messages in the thread.

Selected labels are alternatives. Source date/query settings are authoritative result checks; pagination may be necessary to find more allowed candidates. Custom-query pages are reduced to fit the additional permission-check requests while preserving Gmail's continuation token. The existing source defaults exclude Promotions and Social unless disabled. Google documents that API search matches messages and differs from Gmail UI thread matching and alias expansion: [Gmail filtering guide](https://developers.google.com/workspace/gmail/api/guides/filtering).

### Google Calendar

Member mode searches calendars accessible through the member's account. A meeting visible in several calendars is returned once, preferring the member's primary calendar, and date-bounded agendas are ordered by scheduled start across calendars. Service mode verifies the account's primary-calendar identity, Directory customer, and source user selection before delegating to that same Workspace user. Selected calendar IDs constrain retrieval and source verification; `primary` means that member's primary calendar. The admin picker browses the delegated administrator's calendar list and stores `primary` as a per-member alias. Service search delegates with only `calendar.events.readonly` (plus `admin.directory.user.readonly` for the Directory check), the same scope as the indexed crawl; all-day events take the calendar's time zone from the events list response. The picker additionally needs `calendar.readonly` ([CalendarList authorization](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)).

Each event must exist under the source's delegated token, be in an allowed calendar, not be cancelled, and overlap the source's configured rolling time window. The existing default is 30 days before and after the request. A stable UTC-day envelope around that window is intersected with the user's date bounds in the provider query, ensuring recurring events expand and query bounds stay stable between pages. The exact rolling source window is still checked for each result. Nonoverlapping date ranges return no results; continuations spanning a UTC-day change may require a fresh search. A source search query is checked with Calendar's event search and exact event-ID matching. All-day events use the calendar's timezone. Attendee details follow the source's include-attendees setting. The member's API access still determines which event details they can see.

### Slack

Member mode only. Search uses the connected user's Slack real-time search grant and provider search syntax. Date bounds are sent as numeric provider timestamps; date ordering selects keyword retrieval and timestamp sort, because Slack semantic retrieval uses relevance ordering. Channels, messages, direct messages, and files are limited by that grant and provider scopes; there is no admin channel filter in member mode. Missing required search scopes produce a reconnect status. Thread/file reads use the same connected identity.

### GitHub

Member mode searches issues, code, repositories, and commits permitted by the connected token. Commits are searched only with an explicit `commits` kind; they cover each repository's default branch, and a commit read lists up to 100 changed files. Explicit repository/organization/user qualifiers narrow the user's query. Default discovery is bounded to up to 100 affiliated repositories, sent as `repo:` qualifiers in at most four batches per search kind. Code batches stay under code search's 1,000-byte query limit, issue batches are larger, and a long query that cannot fit every repository reports the searched subset. Date bounds become one `updated:start..end` range (`author-date:` for commits), since GitHub ORs repeated qualifiers. Provider pagination/search caps still apply. REST code search returns no file dates and accepts no date qualifier, so date-filtered searches cover issues and pull requests only.

In service mode, an administrator connects a GitHub App installation and selects repositories one by one in Sources. Each source pins the provider-verified repository ID and may narrow code files by directory and extension. Search queries the member's own GitHub connection with `repo:` qualifiers drawn only from active sources. For each candidate, Sim checks that the current App installation still covers that repository, mints a repository-scoped read token, and compares repository and owner IDs returned under both the App and member tokens. It then checks the per-repository code filters. Reads use the member token and repeat these checks. A personal repository outside the selected sources is never searched, even if the member can access it. GitHub REST code search covers the default branch; live Sources therefore do not offer a branch setting.

### Jira

Member mode only. Search resolves the connected user's accessible Atlassian sites, runs JQL, and reads issues with that user's OAuth grant. Project and site restrictions supplied in a search narrow the query. No organization resource filters constrain member mode.

### Confluence

Member mode searches pages and blog posts across accessible sites through the member's OAuth grant. Service mode additionally verifies the source credential's cloud/site identity and selected spaces, current content status, content type, and labels. The member's search results must also be readable by the source credential.

The provider query incorporates the configured content type, so a blog-post source does not accidentally use the page-only default. Selected source labels use OR semantics, matching staging. Spaces must be explicitly configured, with `*` representing all spaces; missing required configuration fails closed. Source checks run again for document reads.

### Coda

The preferred member connection is personal Coda MCP OAuth. Sim discovers the configured server's advertised schemas and proxies only its fixed read-tool allowlist: `search`, `url_convert`, `content_read`, `document_outline`, and `table_rows_read`. It validates arguments and reloads the member's current managed grant before execution. The model cannot choose a server URL or invoke writes through this adapter.

MCP search covers page and table-row content, permits empty-query recency listing, and uses document URIs for scoped searches. The current Superhuman Docs server returns a `toolName`/`result` envelope and `superhuman://docs/` resources, sometimes with page paths relative to `docUri`; the adapter unwraps and resolves those while retaining older `coda://docs/` references. Results are bounded to the advertised search limit. Official Coda web URLs are converted to document URIs before source checks. A legacy personal REST token can still search document titles, with correctly forwarded pagination; it does not provide MCP's full-content search.

In service mode, the source's selected document IDs restrict MCP retrieval. Every candidate's parent document must also be currently visible to the source token. With an Enterprise organization ID, the Admin API must return that exact document in the configured organization; deleted documents and revoked key access are rejected. Personal MCP still enforces the member's permission to read the actual content. [Official MCP tool catalog](https://coda.io/resources/mcp/tools-and-endpoints).

### GitLab

Service mode only, with no member GitLab connection. Each configured source fixes the instance, project, token, and permission strategy. Members search the configured project through that token, but each result must separately match their verified organization identity and source ACLs.

With an admin token, shared permission primitives load current GitLab identities, group/project membership, and document restrictions within the request. They do not persist a background directory snapshot or trust stored external-group memberships. Complete permission reads are bounded and fail closed on timeout or incomplete pages. With a non-admin token, the current connector-local CSV mappings directly define member grants; legacy indexed ACL rewrite markers do not block those live grants. CSV project/host identity must still match the token's current project, and confidential issues are excluded in CSV mode.

Content types, code branch/tag, path prefix, file extensions, and issue state/labels/milestone are checked. Code search is sent with the configured ref; returned revision evidence must match instead of being rewritten to the configured value. Reads recheck ACLs using fresh content metadata. CSV correctness and updates remain the administrator's responsibility. [GitLab Search API](https://docs.gitlab.com/api/search/).

## Adding a live Search connector

A workspace KB connector and a live Search provider are different runtime integrations. `listDocuments`/`getDocument`, hashes, chunks, and embeddings remain the KB contract; adding those functions alone does not implement live Search. There are currently nine live providers, while the broader KB registry contains additional providers that are not advertised for Search.

### Registration and ownership

Paths below are relative to `apps/sim`.

| Concern | Canonical location | What to add |
| --- | --- | --- |
| Name, logo, auth metadata, config fields | `connectors/<provider>/meta.ts`, registered in `connectors/registry.ts` | Reuse the existing icon from `components/icons`; keep metadata browser-safe. Set `search: true` only when live behavior is implemented and tested. |
| Supported provider ID, default origin, credential aliases, account modes | `lib/sim-search/live/provider-catalog.ts` | One `LIVE_SEARCH_PROVIDER_CATALOG` entry. The MCP/tool enum, credential matching, and mode availability derive from it. |
| Search endpoint and response conversion | `lib/sim-search/live/<provider>.ts` | Implement the provider's documented query, bounded pagination, source dates, snippets, URLs, and status behavior through `NativeClient`. |
| Document-read endpoint | The same provider module | Read the exact returned reference and return `NativeDocument`. Support every kind the search adapter can emit. |
| Runtime registration | `lib/sim-search/live/providers.ts` | Register both `search` and `read` in `LIVE_SEARCH_PROVIDERS`. Its exhaustive type requires both for every catalog entry. |
| OAuth or managed credentials | Existing `lib/oauth`, `lib/credential-groups`, and credential application operations | Register actual scopes and refresh behavior; resolve the acting user's grant server-side. A catalog alias does not configure OAuth itself. |
| Service-mode resource fields | `lib/sim-search/live/source-settings.ts` | Expose only fields that live verification actually enforces. Branding and original field definitions stay in ConnectorMeta. |
| Service source loading and validation | `service-sources.ts`, `source-policy.ts`, `service-session.ts`, provider verifier | Bind current org/provider/source identity; independently verify member results against current source access and settings. Do not advertise service mode without this. |
| Resource pickers | `lib/selectors/manifest.ts` and a shared server attachment | Use existing selectors and canonical manual-input pairs. Keep provider calls and credentials out of client code. |
| Authorized orchestration | `lib/sim-search/live/application.ts` | Reuse `searchLiveKnowledge`/`readLiveDocument`; do not add provider-specific API routes or separate MCP authorization. |
| User guide | `apps/docs/content/docs/search/<provider>.mdx` (repository-relative) | Describe setup, actual modes, query/read coverage, filtering, and provider limitations without ingestion copy. |

The provider catalog holds a trusted origin, not an arbitrary URL supplied by a model. Actual endpoint paths and query translation belong in the provider module. `http.ts` supplies bounded responses, a per-client request budget, timeout/cancellation, configured-endpoint validation, and no credential-bearing redirects. Use its origin-bound path API; do not return tokens to UI or model tools.

Self-managed GitLab is resolved from the saved source's validated host/project instead of the catalog's default origin. Coda MCP is a deliberate adapter exception: its current managed server/grant is resolved by `mcp-accounts.ts` and `coda-mcp.ts`, which discover tool schemas and permit only the fixed read tools. Neither exception lets a search query choose a credential destination.

### Provider endpoint map

| Provider | Search | Read | Service boundary |
| --- | --- | --- | --- |
| Drive | `GET /drive/v3/files` with Drive `q` | File metadata, Docs/Slides exports, Sheets values, or supported text media | Delegated Drive file visibility and configured folders/types |
| Gmail | `GET /gmail/v1/users/me/messages` with Gmail operators | That exact message with `format=full` | Same-mailbox delegation, labels, date range, category and custom-query checks |
| Calendar | CalendarList then `/calendars/{id}/events` | `/calendars/{id}/events/{eventId}` | Same-user delegation, selected calendars, event window/query |
| Slack | `POST /api/assistant.search.context` | `conversations.replies` or `files.info` preview | Member only; Slack enforces the connected user's grant |
| Jira | `POST /ex/jira/{cloudId}/rest/api/3/search/jql` | `/rest/api/3/issue/{key}` under that cloud site | Member only |
| Confluence | `/ex/confluence/{cloudId}/wiki/rest/api/search` with CQL | `/wiki/rest/api/content/{id}` | Same site, spaces, current type/status/labels, source readability |
| GitHub | `/search/issues`, `/search/code`, `/search/repositories`, `/search/commits` | Issue, repository, commit, or contents endpoint for returned kind | Added repositories; installation coverage/stable IDs and code filters |
| GitLab | Configured `/api/v4/projects/{project}/search`, or supported date listing | Project issue/MR/wiki/file endpoint | Current request-local admin ACL evidence or saved CSV grants, plus content filters |
| Coda | Personal MCP `search`; REST `/apis/v1/docs` title-search compatibility | MCP read allowlist; REST compatibility document/page reads | Selected parent doc and current source-token visibility; optional Enterprise org membership |

GitHub members use App user tokens. The deployment App needs read permissions for Contents, Issues, and Pull requests for full supported search/read coverage, plus Metadata, organization Members, and user Email addresses for existing setup/identity checks. Installation tokens used to prove repository coverage stay narrowed to contents/metadata; do not use them to replace the member's content grant.

### Shared invariants

- Keep provider parsing isolated from authorization. The application operation owns current membership, policy loading, active account resolution, scoped references, and result projection.
- Member mode has no saved resource filters. A user's native query may narrow scope, but cannot widen a service-source boundary.
- Verify a candidate before returning its title, snippet, or citation. Re-resolve grants/settings and verify again when reading. Unsupported policy or incomplete permission evidence must fail closed.
- Bind document references and continuations to the current provider/account/scope. Preserve provenance registration and the response projection used by web Search, Assistant, Slack, and Search MCP. Never create a parallel unfiltered adapter for one surface.
- Report bounded or partial retrieval explicitly. A provider cursor must remain tied to the same query and account; do not infer complete coverage from an empty page.
- Do not schedule Search content, embedding, or directory/ACL work in live mode. Reuse `requiresConnectorIndexing`/`connectorIndexingCondition` at dispatch and worker entry so old queued jobs are guarded too.

### Verification before advertising a provider

Run the catalog registration test, provider tests, shared application tests, and service-mode tests when applicable. Tests must exercise allowed and denied readers, wrong org/account references, source/filter changes between search and read, revocation, native-query bypass attempts, continuation, unsupported date metadata, rate limits, cancellation, and response limits. Check both flag states so ordinary KB indexing and explicit legacy Search remain supported.

For end-to-end verification, use authorized fixture accounts on localhost: add the source, exercise the real picker, connect a member, search and read a known fixture, change the boundary/access, and verify denial on both search and reread. Capture screenshots without tokens or private document content. Record unavailable credentials, provider app eligibility, licenses, or network restrictions as unverified cases; mocked API tests do not establish real-provider compatibility. Include GitLab admin and CSV paths on a reachable self-managed instance and Coda MCP tool discovery when those modes are shipped.

## Coverage and operational limits

- API scopes, provider indexing latency, pagination, selected calendars/folders/documents, request deadlines, and bounded fan-out affect recall. Partial results must be presented as partial.
- A Google service account requires the provider's actual domain-wide delegation setup and allowed scopes; selecting a mode does not grant permissions. [Google service account delegation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority).
- A service source limits content; it does not grant a member access they lack. GitLab is the explicit exception to personal-provider retrieval and uses separate source ACL checks.
- Credential Groups and standard knowledge-base connectors remain unchanged. Search's old content-index status is not an authorization dependency for federated requests. Indexed ACL rewrite markers are retained so switching back cannot expose previously indexed content under stale permissions.
