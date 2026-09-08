# Organization connected accounts

An organization has at most one account pool. Owners and admins manage it in **Organization settings → Connected accounts**, with Providers, People, and Workspace access tabs. The initial workspace allowlist is empty. Personal account settings show the signed-in person’s own contributions, including contributions to organizations they have not joined.

Organization settings selects one setup page: **Connected accounts** when `credential-groups` is available and `knowledge-member-access` is off, or the Search **Integrations** page when both are available. The two pages remain separate; the inactive page is hidden from navigation and returns not found on direct access. This switches the settings UI without changing credential-group API access or stored workspace policies.

Both pages include **People → Request connections**, with the existing manual email invitation, Resend, and Revoke actions. Search-enabled orgs open **Settings → Integrations → People**; Providers remains the default tab. If no org credential group exists, People directs the admin to provider setup first. Search approval alone does not configure a provider for account invitations.

## Permissions

An allowed workspace grants every normally authorized manual and deployed workflow access to every active contribution in this pool. There is no per-workflow resource-policy grant and no per-person filtering for workflow execution. Keep ordinary workspace/workflow authorization and deployment authority: an allowlist entry alone cannot authorize running a workflow. Nested workflows use their actual execution workspace. A workspace move, revocation, inactive enrollment, removed provider, disabled group, or unavailable org entitlement blocks subsequent use.

Standalone Chat uses the signed-in person’s own connections. Invited contributors do not need organization membership. Redemption requires a verified matching Sim email; the enrollment is then bound permanently to that user ID. An email change cannot transfer an enrollment. OAuth callbacks require the same verified signed-in user who started authorization. Search requires current organization membership and applies document permissions using the viewer's own verified provider identities; workspace access to the shared credential pool does not grant access to other people's indexed documents.

Disconnect revokes the local grant and invalidates pending invitation-based authorization. Administrators can revoke an enrollment; the person cannot restore it themselves. Removing workspace access stops future authorized calls, but cannot recall a provider request already in flight or erase data already returned to a workflow. Full-pool sharing includes public, scheduled, and webhook deployments that otherwise pass workflow authorization.

## Credential block

| Operation | Inputs | Output |
| --- | --- | --- |
| Select Credential | Workspace OAuth credential | Existing credential reference |
| List Credentials | Optional workspace provider filter | Existing reference list |
| Find Organization Account | Email and OAuth provider | Exactly one reference, otherwise an error |
| List Organization Accounts | Optional email/providers, limit/cursor | Bounded reference page |
| Find Organization MCP Connection | Email and MCP provider | Exactly one personal MCP reference, otherwise an error |
| List Organization MCP Connections | Optional email/provider, limit/cursor | Bounded MCP reference page |

MCP `credentialId` identifies the person’s connection (`mcp-cg-…`) and is used to select the connection in the MCP block. `mcpServerId` identifies shared configuration and does not grant access to a person’s token. The block never returns secrets or invitation links. Org operations are hidden in ineligible workspaces; saved invalid configurations fail during execution.

Credential trigger mode supports `credential_added`, `credential_reconnected`, and `form_submitted`. Events go to opted-in, currently deployed Credential triggers in allowed workspaces. Legacy Credential Group blocks are hidden and fail with an explicit replacement instruction; they are not automatically rebound.

## Providers

The Providers tab lists only added providers. **Add provider** opens a searchable catalog with the remaining providers. Required configuration is completed before adding a provider; **Configure** reopens Slack or Databricks settings directly. Providers without required setup are added directly. Providers have **Remove** in their actions menu. Individual account connections remain in People. Connected accounts does not display indexing status, load Search sources, or open indexing setup.

- Fireflies and Granola: an admin adds the provider; Sim supplies the fixed hosted MCP endpoint and dynamic client registration. Each person completes their own OAuth authorization.
- Databricks: **Add** collects and validates the organization's tenant MCP URL and registered OAuth client before creating an enabled provider in one transaction. Cancelling leaves nothing added. Organization owners and admins create it through `POST /api/organizations/[id]/connected-accounts/mcp-providers` and read or edit settings through `GET` / `PUT /api/organizations/[id]/connected-accounts/databricks`; no workspace configuration is used. Unfinished entries from the earlier flow appear in the Add catalog until their configuration is saved. The form never reads stored client secrets, and leaving the secret blank when editing preserves it. Endpoint/client identity changes invalidate affected grants and pending attempts, requiring people to reconnect.
- Slack personal OAuth: the org admin supplies App ID, Slack workspace ID, client ID, and client secret, then verifies authorization. The org has one configured app/workspace. Existing workspace bots and their triggers remain separate.

Search approval and source setup are managed through **Organization settings → Integrations**. Approval alone does not create a credential or start indexing. Support for indexing connected accounts comes from the existing Search connector registry's permission-scoped OAuth ingestion capabilities: Gmail, Google Drive, Google Calendar, GitHub repositories, Jira, Confluence, and Slack. Source setup collects any required repository, domain, space, or other settings. Reconnecting an OAuth account queues the existing active sources for that option; it never enables paused indexing.

Both `CREDENTIAL_GROUPS` and `KNOWLEDGE_MEMBER_ACCESS` must be enabled locally. Hosted deployments additionally enforce the routed org's feature rules and Enterprise availability. Owners and admins manage indexing; existing Knowledge permission-group rules still apply. Managed MCP account connections remain available for live tool calls only and have no indexing switch. Separate API-key KB connectors for Fireflies, Granola, and Databricks do not consume these managed MCP connections.

### Feature gates

| Surface or behavior | Required organization flags |
| --- | --- |
| Connected accounts settings page | `credential-groups` enabled, `knowledge-member-access` disabled |
| Provider setup APIs, personal contributions, workspace access to the pool | `credential-groups` |
| Indexing On, member sync, organization Home/Assistant and chat pages, Integrations source setup, Search MCP settings | `credential-groups` and `knowledge-member-access` |
| Organization Search MCP endpoint and organization knowledge search through internal/public APIs or trusted tools | `credential-groups` and `knowledge-member-access`, checked after current authorization |

The Search gate uses the persisted knowledge base owner or the authenticated route's target organization. User, platform-admin, and workspace targeting cannot opt a different organization into Search. Disabled organizations receive `403 Search is not enabled for this organization` before index lookup or model execution; hiding navigation is not the authorization boundary. Organization Home, Search, and chat URLs open full settings in the viewer's most recent accessible workspace when Search is disabled. Default app entry uses that same destination, and Home, Integrations, chat history, and Assistant loading UI are hidden. Connected accounts settings and Workspaces remain available. Settings and source-setup URLs also enforce their gates. Ordinary workspace knowledge search keeps its existing behavior. Pausing configured indexing remains available to authorized org admins when the Search flag is off.

For a targeted hosted rollout, configure both existing flags in AppConfig's `feature-flags` document:

```json
{
  "credential-groups": { "enabled": false, "orgIds": ["org-to-enable"] },
  "knowledge-member-access": { "enabled": false, "orgIds": ["org-to-enable"] }
}
```

`enabled: true` enables a flag globally; it is not needed alongside an org allowlist. Off AppConfig, `CREDENTIAL_GROUPS=true` and `KNOWLEDGE_MEMBER_ACCESS=true` are deployment-wide switches and cannot target individual organizations. Both flag checks still apply the organization's hosted Enterprise/billing requirements and normal membership, permission-group, and document access checks. These examples document configuration only; this change does not update a deployed AppConfig document.

Credential-groups rollout never evaluates `workspaceIds`. Existing workspace-scoped callers resolve their owning organization and use its `orgId`; personal workspaces cannot enable connected accounts. This flag rollout is separate from the organization's workspace access allowlist, which still controls which workflows may use the pool. Normal settings no longer prefetch the legacy workspace-owned account container.

Current bounds: 100 entries per discovery page, 1,000 workspace allowlist entries, and 1,000 deployed event subscriptions per organization. Event delivery is synchronous after enrollment commits; a delivery failure surfaces as an error and does not roll back the saved connection. An outbox/retry mechanism is not included.

## Rollout

OAuth attempt state changes at this release boundary (OAuth v5 and managed MCP v3). Older attempts lack a verified Sim user binding; older MCP attempts also lack the configuration version. They are deliberately rejected before token exchange, with an explicit instruction to reopen the invitation and connect again. Existing saved credentials are not invalidated by the state version change. Mixed application versions cannot complete each other's in-flight attempts: pause enrollment starts, allow the ten-minute state lifetime to drain, replace the application instances together, and only then reopen enrollment and enable the org rollout. Do not run enrollment OAuth across mixed versions or roll back with active attempts.

1. Apply `0328_organization_connected_accounts.sql` before deploying code that reads the new columns. It expands ownership columns and checks, adds stable enrollment identity and MCP configuration versions, and builds indexes concurrently. No grants, enrollments, or Search data are moved or deleted. Constraints are added `NOT VALID` to avoid scanning existing tables while holding the DDL lock; validate them separately after auditing existing rows.
2. Inventory existing groups and their Search dependencies before enabling the feature. The queries below read IDs/counts only. Review archived/deleted sources too because a reset must account for retained documents and cleanup work.
3. Existing org groups without the new v2 workspace policy stop with a migration-review error. Do not insert a v2 policy over legacy contributions. Resolve Search dependencies explicitly, retire the old group through an audited maintenance procedure, create a fresh org pool, and invite people to reconnect. No reset command is supplied or run by this change.
4. Enable the existing `credential-groups` feature flag for the target org (`orgIds`), then set up providers and allow specific same-org workspaces. A previous workspace-only feature-flag allowlist does not enable the org surface. Sim Cloud also requires an active Enterprise entitlement.
5. Replace legacy workflow blocks, reconfigure credential references, and redeploy event subscribers. Verify one manual run, one deployed run, and one revocation before widening the workspace allowlist.

```sql
SELECT cg.id, cg.organization_id, cg.workspace_id,
       (SELECT count(*) FROM credential_group_enrollment e
        WHERE e.credential_group_id = cg.id) AS enrollments,
       (SELECT count(*) FROM credential c
        JOIN credential_group_enrollment e ON e.id = c.credential_group_enrollment_id
        WHERE e.credential_group_id = cg.id) AS credentials,
       (SELECT count(*) FROM knowledge_connector kc
        WHERE kc.credential_group_id = cg.id) AS search_dependencies
FROM credential_group cg
ORDER BY cg.id;

SELECT kc.id AS connector_id, kc.credential_group_id, kc.knowledge_base_id,
       kc.access_mode, kc.deleted_at
FROM knowledge_connector kc
WHERE kc.credential_group_id IS NOT NULL
ORDER BY kc.credential_group_id, kc.id;
```

The migration is rerunnable after partial completion. If a concurrent index build leaves an invalid index, the final check fails with its name; repair that index explicitly before retrying. Keep the flag off during rollback. Earlier app versions do not understand the org sharing policy or stable enrollment identity; rollback does not transfer new org grants back to workspaces.
