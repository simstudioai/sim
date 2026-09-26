# Coda indexed connector decisions and verification

This document covers ordinary knowledge-base ingestion and the explicitly selected legacy Search backend (`SIM_SEARCH_LIVE=false`). Its historical verification notes refer to that indexed path. Default live Search uses personal Coda MCP authorization plus optional service-source verification; see [live Search](../../lib/sim-search/live/README.md) and the [Coda Search guide](../../../docs/content/docs/search/coda.mdx). Background Coda content/ACL/directory builds are not part of live Search.

## Precedent and authentication

| Reference | Verified behavior | What it establishes for Sim |
| --- | --- | --- |
| [Glean Coda search](https://www.glean.com/connectors/coda) | Native document/page indexing with query-time source permissions. | The same access-control objective. The public page does not specify the crawler's credentials, endpoints, directory expansion, or deletion strategy; exact implementation parity is not established. |
| [Glean Coda agent service credential](https://docs.glean.com/administration/agent-identity/coda) | A dedicated Coda user and an MCP-restricted token for agent tools. | Dedicated identity and credential rotation are useful operational precedent. This is a separate MCP integration, not the REST indexing setup; its MCP token restriction must not be copied into Sim's connector instructions. |
| [Onyx Coda connector](https://github.com/onyx-dot-app/onyx/blob/5fe6573c3c155e1a75b51de32d4988ee6c82164e/backend/onyx/connectors/coda/connector.py) | A bearer token, optional workspace scope, page content, and table rows through the public REST API. | Direct precedent for ordinary content ingestion. Sim uses bounded deferred hydration rather than collecting the entire source before indexing. |

Onyx's [test setup](https://github.com/onyx-dot-app/onyx/blob/5fe6573c3c155e1a75b51de32d4988ee6c82164e/backend/tests/daily/connectors/coda/README.md) also uses an API token generated in account settings. Its reviewed Coda implementation has no source ACL or directory calls, and its [permission-sync registry](https://github.com/onyx-dot-app/onyx/blob/5fe6573c3c155e1a75b51de32d4988ee6c82164e/backend/ee/onyx/external_permissions/sync_params.py) has no Coda entry. It therefore does not establish Enterprise permission parity. Coda's own API documentation is the authority for Sim's Enterprise path.

This connector reuses Sim's existing `coda-service-account` token credential and its selector. The metadata's `oauth` discriminator means “use a stored credential” in the shared connector framework. The actual credential is an API token, with no OAuth authorization or refresh flow. Personal credential-group enrollment is not exposed because that flow currently requires OAuth. Admin indexing matches provider-reported grants to verified Sim emails instead.

## API contract audit

All connector requests are GET requests authenticated with `Authorization: Bearer`. The following operation IDs were checked against the OpenAPI specifications embedded in Coda's [public reference](https://coda.io/developers/apis/v1) and [Admin reference](https://coda.io/developers/apis/admin/v1), including query parameters, response fields, pagination, and allowed formats. None of these operations is deprecated.

| API | Operations used |
| --- | --- |
| Public identity and discovery | `whoami`, `listDocs`, `getDoc` |
| Public content | `listPages`, `getPage`, `listPageContent`, `listTables`, `getTable`, `listColumns`, `listRows` |
| Public permissions | `getPermissions` |
| Admin discovery | `getOrganization`, `listDocs` with `docIds` or `docAvailabilityState` and `fetchPermissionsMode=none` |
| Admin content and permissions | `listPagesV2`, `getPageV2` with `outputFormat=LossyPlainText`, `listDocPermissionsV2` |
| Admin directory | `listOrgUsers`, `listGroups`, `listGroupMembers`, `listWorkspaces`, `listWorkspaceUsers` |

The Admin API requires an [Enterprise organization administrator](https://help.superhuman.com/hc/en-us/articles/46210125237901-Intro-to-Superhuman-Docs-Admin-API). Ordinary workspace admin access does not satisfy that requirement. All network calls use the shared secure fetch/retry path and fixed API origins; the connector uses no browser session, private endpoint, credential impersonation, or provider permission mutation. Synthetic directory groups are Sim's internal representation of documented grants, not invented Coda API objects. Size and crawl limits below are Sim safeguards, not claimed Coda service limits.

## Access tradeoffs

- Without an organization ID, only ownership and direct email grants establish individual access. Workspace, domain, group, and unknown principals are not expanded. Link possession never grants Search access. The public API does not provide organization account status; this mode cannot independently detect organization-level deactivation while a direct grant remains. Sim membership lifecycle must also be managed.
- With an Enterprise organization ID, the Admin API supplies organization discovery and directory membership. Direct users and domains use synthetic groups so deactivated/deleted organization users cannot resolve grants. External direct-share guests absent from the organization directory are conservatively excluded. Explicit group/workspace guests remain eligible unless the directory reports them inactive.
- Opaque group/workspace IDs are hex encoded before shared case-folding. Tenant IDs remain source-exact. This avoids merging case-sensitive Coda IDs.
- Every listed document's complete ACL is read on every sync, independently of content hashes. Partial/failed ACLs are omitted so the shared engine fails closed. Directory snapshots are collected under the shared directory lease and never reported complete after a truncated response.
- Permission freshness, query authorization, and directory persistence remain in the existing shared engines. Workspace access mode deliberately grants workspace-wide access and is separate from organization Search.

## Content and pagination tradeoffs

The [public API](https://coda.io/developers/apis/v1) exposes canvas plaintext and base-table rows; the [Admin API](https://coda.io/developers/apis/admin/v1) exposes `LossyPlainText` page exports. Admin exports are not equivalent to independently fetching every table. Hidden/embed/synced pages are excluded on the public path; the Admin API does not expose those public page-type flags. Neither path extracts arbitrary attachments or remote embeds.

Admin document reads use the current workspace-qualified endpoints, resolving the workspace with the documented organization `docIds` filter. Metadata queries request `fetchPermissionsMode=none`; permissions come only from the complete paginated ACL endpoint.

Listing defers content and retains only the current parent document metadata in the per-run context, avoiding one redundant parent fetch per child. Resource content and permissions are still read from the provider; ACLs never use that metadata cache. Discovery fetches ten parent documents at a time. Compound cursors persist that bounded queue, the current document, child phase, and provider token for durable replay, under the shared 512 KiB cursor limit. Only `pageToken` is sent on continuation requests, as Coda requires. No response URL or redirect receives the credential. Responses, text, list lengths, ACLs, directory entries, and pagination loops are bounded and fail rather than silently truncating. Responses are limited to 4 MiB, indexed text to 12 MiB, and hydration concurrency to two. The stubs advertise the text bound to the shared byte-budget scheduler. Directory entries are limited to 100,000, email lengths to 254, and document permissions to 5,000. Domain memberships are indexed once instead of scanning every user for every domain.

Hashes use the parent document revision because table-list references do not guarantee a row-sensitive timestamp. A document edit invalidates all its children, trading extra reads for correctness. Explicit full resyncs also refresh rendered dependencies. When the Admin API omits its optional revision timestamp, the shared durable sync-generation ID forces one refresh per crawl, following the Slack/GitLab pattern. It remains stable across retries within that generation.

Discovery order is mutable and the public list omits never-opened documents. Discovery is therefore non-authoritative for deletion reconciliation. Explicit document IDs provide authoritative scope; confirmed 404/410 documents reconcile, while 403s remain errors. Up to 100 explicit IDs are supported per source. Setup probes one document and one ACL page to keep request latency bounded; sync checks the remaining scope.

## Reproducible checks

```sh
bun run --cwd apps/sim test connectors/coda/coda.test.ts connectors/coda/permissions.test.ts lib/selectors/server/providers/coda.test.ts lib/credentials/token-service-accounts/validators/coda.test.ts lib/selectors/manifest.test.ts
CODA_CONNECTOR_LIVE_TOKEN_FILE=/path/to/token bun run --cwd apps/sim test --mode live connectors/coda/coda.live.test.ts
```

The provider test creates and deletes its own document. `CODA_CONNECTOR_LIVE_ORGANIZATION_ID` enables additional Enterprise export/ACL/directory checks against that fixture when the token belongs to an Enterprise organization. Set `CODA_CONNECTOR_LIVE_FIXTURE_FILE=/path/to/fixture.json` to retain it for the application test, then from the repository root:

```sh
CODA_CONNECTOR_LIVE_TOKEN_FILE=/path/to/token \
CODA_CONNECTOR_LIVE_FIXTURE_FILE=/path/to/fixture.json \
CODA_CONNECTOR_LIVE_SECOND_EMAIL=second-user@example.com \
bun run test:integration coda-live.integration.ts
```

The application test uses disposable PostgreSQL/Redis, real credentials, Coda, source creation, ingestion, storage, and authorization. Set `CODA_CONNECTOR_LIVE_SCOPE=organization` to exercise organization credential creation and organization Search instead of a workspace knowledge base. Only embeddings are deterministic substitutes. It changes only the retained fixture's share, with notifications suppressed, and removes that share afterward. `CODA_CONNECTOR_LIVE_ALLOW_SHARING=false` explicitly skips the live grant/revoke cases when source policy prohibits sharing. `CODA_CONNECTOR_LIVE_UI_FIXTURE_FILE` optionally retains isolated rows and writes a temporary signed session for browser verification; use only with the runner's disposable-database retention options and remove both afterward.

## Verification coverage

- Focused connector, selector, credential, navigation, configuration, and integration-availability tests passed. App and deployment-config type checks, Biome, and the strict API-contract audit passed.
- Live provider tests cover page/table hydration, page edits, and row edits. Coda's real initialization `409` led to an explicit retry path.
- Real application setup and ingestion passed in both workspace and organization scope (the live sharing cases require a workspace that allows the intended cross-domain share). Organization scope creates the token credential through the authorized application use case. Owner search/chunks were allowed; another verified user, unverified owner, and workspace API key were denied. Embeddings were substituted, so external embedding-provider behavior was not tested.
- Sim's browser showed the Coda source Active, both indexed documents, the live document picker, inline API-token creation, credential replacement followed by a successful sync, and preserved selection across connection/input modes. Browser checks caught and fixed missing Search URL registration, scope loss when switching modes, deployment metadata rejecting Coda's token credential, and a setup allowlist hiding inline Coda credential creation. Coda's official browser app showed the fixture content.
- Live sharing to the requested second account was rejected by the source policy: “Cross domain sharing is prohibited.” Grant/revoke tests remain unverified live, with unit coverage for ACL changes and incomplete responses.
- The available test account returned no Enterprise organizations; the official UI offers sales-assisted Enterprise setup rather than a self-service trial. Admin API behavior is checked against published schemas and mocked responses; organization-wide crawling, deactivation, and group/workspace/domain permission parity still require an Enterprise tenant test before being considered release-verified.

These remaining provider prerequisites prevent claiming complete live verification.
