/**
 * Every exception the Platform checks grant, in one place. Each allowlist maps an entry (a module
 * path, a file, or a variant) to the one-line reason it was granted, so a reviewer can judge whether
 * that reason still holds. `check-platform-design.ts` reads this module from the root it audits and
 * fails an entry with no reason (`allowlist-reason`) or one no check consulted during the run
 * (`stale-allowlist`): an exception cannot outlive the code it was granted for.
 */
import { ORGANIZATION_ROUTES, PRODUCT_ROUTES } from './platform-product-routes'

export type ReasonedAllowlist = Readonly<Record<string, string>>

/** Grants every entry the same reason, for a group of modules that share one purpose. */
function granted(reason: string, entries: readonly string[]): ReasonedAllowlist {
  return Object.fromEntries(entries.map((entry) => [entry, reason]))
}

const system = '../../packages/emcn-platform/src/'

/**
 * Variants that carry no Paper key, by `Owner.prop=value`, with the reason each stands without one.
 * Every other variant names at least one reachable Paper key; a new code-first variant states its
 * reason here (`platform/AGENTS.md`, Code-first product design).
 */
const CODE_FIRST_VARIANTS: ReasonedAllowlist = {
  'ActivityRow.density=comfortable':
    "Settings' roomier row; a frozen EMCN variant its design owner keeps without a Paper key",
  'ActivityRow.density=regular':
    'The default row density; a frozen EMCN variant its design owner keeps without a Paper key',
  'Avatar.size=card':
    "A card's avatar; a frozen EMCN variant its design owner keeps without a Paper key",
  'Avatar.size=hero':
    "A profile header's avatar; a frozen EMCN variant its design owner keeps without a Paper key",
  'Avatar.size=inline':
    'An avatar set in a line of text; a frozen EMCN variant its design owner keeps without a Paper key',
  'Avatar.size=row':
    "A row's leading avatar; a frozen EMCN variant its design owner keeps without a Paper key",
  'IconButton.size=inline':
    'An action inside a line of text; a frozen EMCN variant its design owner keeps without a Paper key',
  'IconButton.size=row':
    "A ControlRow's trailing action; a frozen EMCN variant its design owner keeps without a Paper key",
  'CopyButton.size=small':
    'The standalone copy action; a frozen EMCN variant its design owner keeps without a Paper key',
  'CopyButton.size=compact':
    "A field's trailing copy action; a frozen EMCN variant its design owner keeps without a Paper key",
  'SearchField.variant=quiet':
    'The borderless toolbar search with its focus underline; a frozen EMCN variant its design owner keeps without a Paper key',
  'TextArea.defaultSize=regular':
    'The 76px default textarea; a frozen EMCN variant its design owner keeps without a Paper key',
  'TextArea.defaultSize=large':
    'The 240px skill instruction editor; a frozen EMCN variant its design owner keeps without a Paper key',
  'Disclosure.variant=navigation':
    "A navigation group's disclosure; a frozen EMCN variant its design owner keeps without a Paper key",
  'MultiSelect.variant=field':
    'The labelled form picker; a frozen EMCN variant its design owner keeps without a Paper key',
  'MultiSelect.variant=text':
    'The compact toolbar text trigger; a frozen EMCN variant its design owner keeps without a Paper key',
  'SearchableSelect.variant=field':
    'The labelled form picker; a frozen EMCN variant its design owner keeps without a Paper key',
  'SearchableSelect.variant=text':
    'The compact toolbar text trigger; a frozen EMCN variant its design owner keeps without a Paper key',
  'DatePopover.variant=field':
    'The labelled form picker; a frozen EMCN variant its design owner keeps without a Paper key',
  'DatePopover.variant=text':
    'The compact toolbar text trigger; a frozen EMCN variant its design owner keeps without a Paper key',
}

/**
 * Components EMCN keeps unexported whose `CODE_FIRST_VARIANTS` entries the frozen surface
 * (`scripts/emcn-surface.json`) cannot confirm, because it records only exported components.
 */
const UNEXPORTED_VARIANT_OWNERS: ReasonedAllowlist = {
  DatePopover:
    'Internal to @sim/emcn/picker/date-picker: DatePicker renders it as field and DateRangePicker as text; it is no public prop',
}

/**
 * Loading paints nothing (`platform/AGENTS.md`): no text such as `Loading…` stands in for content
 * whose read is pending. An action's pending label is feedback, not loading copy, so the rule passes
 * a `pendingLabel` and the pending label of a Load action (`isFetchingNextPage ? 'Loading…' :
 * 'Load more'`). These files keep loading copy for the reason given; each must still contain some.
 */
const LOADING_COPY_OWNERS: ReasonedAllowlist = {
  '../../packages/emcn/src/components/scroll-area/load-more-footer.tsx':
    "The design owner's LoadMoreFooter (b5a30e9744) names a paged list's pending next page",
  [`${PRODUCT_ROUTES}_components/composer/message-composer.tsx`]:
    'The @ menu names its pending list, since the draft keeps focus and typing while it loads',
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/document-view/document-view.tsx`]:
    "The document editor's save status reports a write, not a pending read",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/chat-tab/chat-tab.tsx`]:
    "The identifier field's spinner carries a visually hidden status for screen readers",
  [`${PRODUCT_ROUTES}_components/workspace/tables/table-grid/cell-render.tsx`]:
    "Predates the Waiting synonym: a workflow cell's run status while it waits on upstream columns",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/_components/generate-prompt/generate-prompt.tsx`]:
    'Predates the Generating synonym: the prompt field shows its streaming generation, not a read',
}

/**
 * Helper lines that stay (`helper-copy`, `platform/AGENTS.md`): a field, form dialog, settings row or
 * page header says what it needs in its label, placeholder or options, never in a second line. Each
 * entry names one line as `<file>#<label, title or field id>` and why nothing else can carry it.
 */
const HELPER_COPY_OWNERS: ReasonedAllowlist = {
  ...granted(
    "The design owner's copy, held for his review: listed in the helper-copy audit, not rewritten by it",
    [
      `${PRODUCT_ROUTES}_components/oauth-connect-modal/oauth-connect-modal.tsx#Environment URL`,
      `${PRODUCT_ROUTES}_components/service-account-modal/atlassian-service-account-modal.tsx#API token`,
      `${PRODUCT_ROUTES}_components/service-account-modal/oracle-database-account-modal.tsx#PEM wallet`,
      `${PRODUCT_ROUTES}_components/service-account-modal/oracle-database-account-modal.tsx#Protocol`,
      `${PRODUCT_ROUTES}_components/service-account-modal/slack-bot-modal.tsx#Additional permissions`,
      `${PRODUCT_ROUTES}_components/workspace/files/share-modal/share-modal.tsx#Access`,
      `${PRODUCT_ROUTES}_components/workspace/files/share-modal/share-modal.tsx#Allowed emails`,
      `${PRODUCT_ROUTES}_components/workspace/files/share-modal/share-modal.tsx#Password`,
      `${PRODUCT_ROUTES}_components/workspace/knowledge/add-connector-modal/add-connector-modal.tsx#{members ? 'Account for browsing' : form.canConnectOAuth ? 'Account' : 'Service account'}`,
      `${PRODUCT_ROUTES}_components/workspace/knowledge/add-connector-modal/add-connector-modal.tsx#Sync frequency`,
      `${PRODUCT_ROUTES}_components/workspace/knowledge/add-documents-modal/add-documents-modal.tsx#Documents`,
      `${PRODUCT_ROUTES}_components/workspace/knowledge/connector-modal/connector-modal.tsx#{isSearchIndex ? form.requiresServiceAccount ? 'Service account' : 'Account' : 'Indexing account'}`,
      `${PRODUCT_ROUTES}_components/workspace/knowledge/connector-modal/connector-modal.tsx#Sync frequency`,
      `${PRODUCT_ROUTES}_components/workspace/knowledge/connector-selector-field/connector-selector-field.tsx#{label}`,
      `${PRODUCT_ROUTES}_components/workspace/tables/enrichments-panel/enrichment-config.tsx#{input.required ? input.name : \`\${input.name} (optional)\`}`,
      `${PRODUCT_ROUTES}_components/workspace/tables/enrichments-panel/enrichment-config.tsx#{output.name}`,
      `${PRODUCT_ROUTES}_components/workspace/tables/row-modal/row-modal.tsx#{column.name}`,
      `${PRODUCT_ROUTES}_components/workspace/tables/select-field/select-field.tsx#{column.name}`,
      `${PRODUCT_ROUTES}_components/workspace/tables/workflow-panel/input-mapping-fields.tsx#{field.name}`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/_components/create-mcp-server-modal/create-mcp-server-modal.tsx#Access`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/_components/mcp-server-form/mcp-server-form.tsx#Client secret`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/_components/mcp-server-form/mcp-server-form.tsx#Server URL`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/_components/create-base-modal/create-base-modal.tsx#Chunking strategy`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/_components/create-base-modal/create-base-modal.tsx#Custom separators`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/_components/create-base-modal/create-base-modal.tsx#Overlap (tokens)`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/_components/create-base-modal/create-base-modal.tsx#Upload documents`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/api-tab/api-info-modal.tsx#Access`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/api-tab/api-tab.tsx#Endpoint`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/api-tab/api-tab.tsx#Status endpoint`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/api-tab/api-tab.tsx#Usage limits`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/chat-tab/chat-tab.tsx#{form.authType === 'email' ? 'Allowed emails' : 'Allowed SSO emails'}`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/chat-tab/chat-tab.tsx#IdentifierField`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/chat-tab/chat-tab.tsx#Password`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/chat-tab/chat-tab.tsx#URL`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/mcp-tab/mcp-tab.tsx#ParameterDescriptions`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/mcp-tab/mcp-tab.tsx#Servers`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/mcp-tab/mcp-tab.tsx#Tool name`,
      `${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/deploy/parameter-descriptions/parameter-descriptions.tsx#Parameters`,
    ]
  ),
  [`${PRODUCT_ROUTES}_components/invite-modal/invite-modal.tsx#Email addresses`]:
    'Seat warning: the state of the plan, shown only when the invites exceed the open seats',
  [`${PRODUCT_ROUTES}_components/service-account-modal/google-service-account-modal.tsx#{field.label}`]:
    "A soft format warning, shown only while a pasted value misses the provider's usual shape",
  [`${PRODUCT_ROUTES}_components/skill-fields/skill-fields.tsx#Name`]:
    'Why a view-only skill cannot be edited; a read-only TextField has no disabledReason',
  [`${PRODUCT_ROUTES}_components/workspace/knowledge/connector-fields/connector-fields.tsx#{label}`]:
    "The connector registry's own field description (apps/sim/connectors), shared with the legacy knowledge UI",
  [`${ORGANIZATION_ROUTES}integrations/_components/resource-editor/resource-editor.tsx#Key`]:
    "Design owner's copy, held for his review: the key's format could move into its placeholder",
  [`${ORGANIZATION_ROUTES}settings/_components/sections/integrations/connector-access.tsx#{slackSetupOnly ? 'Slack app' : allowWorkspace ? 'Connection method' : 'Sync using'}`]:
    'Why the chosen connection method is unavailable here, shown only then',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/integrations/connector-config-fields.tsx#{label}`]:
    "The connector registry's own field description (apps/sim/connectors), shared with the legacy knowledge UI",
  [`${ORGANIZATION_ROUTES}settings/_components/sections/integrations/connector-selector.tsx#{label}`]:
    "Forwards a connector registry field's description from connector-config-fields",
  [`${ORGANIZATION_ROUTES}settings/_components/sections/integrations/connector-settings-fields.tsx#{isSearchIndex ? requiresServiceAccount ? 'Service account' : 'Account' : 'Indexing account'}`]:
    'An empty account picker: the viewer must connect an account in Integrations first',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/integrations/connector-settings-fields.tsx#GitHubConnectionField`]:
    'Consequence of the pending access change: it keeps the current repository',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/integrations/github-connection-field.tsx#GitHub`]:
    'Forwards the pending-change consequence from connector-settings-fields',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/integrations/github-connection-field.tsx#GitHub account`]:
    'Forwards the pending-change consequence from connector-settings-fields',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/mothership/mothership-licenses.tsx#Sample license key`]:
    'One-time value: the sample appears once and cannot activate a deployment',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#claude`]:
    'Per-app setup steps the Search MCP docs defer to ("Use the instructions displayed in Sim")',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#claude-code`]:
    'Per-app setup steps the Search MCP docs defer to ("Use the instructions displayed in Sim")',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#codex`]:
    'Per-app setup steps the Search MCP docs defer to ("Use the instructions displayed in Sim")',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#cursor`]:
    'Per-app setup steps the Search MCP docs defer to ("Use the instructions displayed in Sim")',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#devin`]:
    'Per-app setup steps the Search MCP docs defer to ("Use the instructions displayed in Sim")',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#other`]:
    'Per-app setup steps the Search MCP docs defer to ("Use the instructions displayed in Sim")',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#Server URL`]:
    "Renders the selected app's setup steps",
  [`${ORGANIZATION_ROUTES}settings/_components/sections/search-mcp/search-mcp-section.tsx#Terminal command`]:
    "Renders the selected app's setup steps",
  [`${ORGANIZATION_ROUTES}settings/_components/sections/sso/domains-panel.tsx#Host / name`]:
    'Prevents a failed DNS verification when the provider appends the zone',
  [`${ORGANIZATION_ROUTES}settings/_components/sections/sso/scim-panel.tsx#Token`]:
    'One-time secret: Sim stores only a digest and cannot show the token again',
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/settings/_components/sections/teammates/invite-teammates-modal.tsx#Emails`]:
    'Why invites are blocked, or the seat warning when invites exceed the open seats',
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/_components/create-api-key-modal/create-api-key-modal.tsx#API key`]:
    'One-time secret: the key is not shown again',
  [`${PRODUCT_ROUTES}_components/oauth-connect-modal/oauth-connect-modal.tsx#Environment`]:
    'Picking the wrong Salesforce login server fails as a plain bad-password error',
}

/** Frames that size a composer docked between surfaces, where foundation tokens do not reach. */
const FRAMES_OUTSIDE_SURFACE: ReasonedAllowlist = {
  [`${ORGANIZATION_ROUTES}home/_components/home-dashboard/home-dashboard.module.css`]:
    "Home's dashboard frame sizes the composer it hosts",
  [`${system}components/page-column/page-column.module.css`]:
    'The page column measures the composer docked beneath it',
}
/** Row bleeds (`page-overflow`) a `PageOverflow` wrapper cannot express yet. */
const ROW_BLEED_OWNERS: ReasonedAllowlist = {
  [`${ORGANIZATION_ROUTES}home/_components/activity-list/activity-list.module.css`]:
    "The scroll viewport is bounded by its section's height; a wrapper would break that min-block-size chain",
  [`${ORGANIZATION_ROUTES}home/_components/home-workspaces/home-workspaces.module.css`]:
    "The scroll viewport is bounded by its section's height; a wrapper would break that min-block-size chain",
}
/** Pages that measure their own chrome for a table's scroller, or theme React Flow through its variables. */
const LOCAL_TOKEN_OWNERS: ReasonedAllowlist = {
  [`${ORGANIZATION_ROUTES}people/_components/directory/directory.module.css`]:
    "People's directory measures its own toolbar for the table's sticky scroller",
  [`${ORGANIZATION_ROUTES}people/_components/org-chart/org-chart.module.css`]:
    'The org chart themes React Flow through its custom properties',
}

/**
 * The application use cases and server helpers a server-only seam module runs in process, as the
 * routes behind its contracts do, with the viewer's session principal. A server-only module never
 * reaches a browser bundle, so `checkSeamClosure` does not walk from one; a module that is not
 * server-only (or its test) may not name these. Each entry carries the one-line reason it was granted.
 */
const serverSeamHelpers: ReasonedAllowlist = {
  'lib/auth': "getSession, the viewer's session that every server read and redirect starts from",
  'lib/auth/session-response':
    'toAppSession and getActiveOrganizationId, the session shape startShellPrefetch seeds',
  'lib/auth/sso/application/provider-settings':
    "The SSO provider list use case, prefetched for Settings' Single sign-on",
  'lib/core/network/application/read-organization-network':
    "The outbound network use case, prefetched for Settings' Security",
  'lib/organizations/application/configuration':
    "The session policy and data retention use cases, prefetched for Settings' Security and Data retention",
  'lib/permission-groups/application/use-cases':
    "The permission group and workspace list use cases, prefetched for Settings' Permission groups",
  'lib/billing/application/organization-billing/get-organization-billing-summary':
    "The billing summary use case behind the billing route, prefetched for Settings' Billing",
  'lib/core/application/organization-authorization':
    'OrganizationMembershipNotFoundError, which readOrganizationSurface answers as not found',
  'lib/core/utils/deadline': 'withinDeadline, the budget server-read holds a first-paint read to',
  'lib/core/orchestration/types':
    "asOrchestrationError, which reads an old credential link's not found or forbidden as not found",
  'lib/credential-groups/application/organization-access':
    "The account workspace-access use case behind Connected accounts' route",
  'lib/credential-groups/application/organization-account-management':
    "The account people use case behind Connected accounts' route",
  'lib/credential-groups/application/organization-accounts':
    'The Connected accounts settings use case, read for that section and the member inventory',
  'lib/knowledge/application/search-history': 'The Search history use case, prefetched for Search',
  'lib/knowledge/application/search-integrations':
    'The Search integrations use case, prefetched for the member inventory',
  'lib/knowledge/application/slack-search/installations':
    'The Slack Search installations use case, prefetched for its Settings section',
  'lib/mothership/chat/intent': "ConversationMode, the chat gate's mode type",
  'lib/mothership/chat/lifecycle': "getAccessibleCopilotChatAuth, the chat route's access check",
  'lib/mothership/chat/organization-chats':
    "The organization chats list, prefetched for the shell's sidebar",
  'lib/navigation/legacy-redirects':
    'mapLegacyWorkspaceUrl, the table of pre-Platform workspace URLs route resolution redirects',
  'lib/navigation/shell-scope': "The proxy's shell scope and path headers and their parser",
  'lib/organization-secrets/application/use-cases':
    'The Generic Secrets source use case, read for Integrations and its prefetch',
  'lib/organizations/application/member-roster':
    "The roster use case behind People's route, prefetched",
  'lib/organizations/surface':
    'resolveOrganizationLanding, which organization a blocked workspace entry forwards to',
  'lib/organizations/application/surface':
    'The organization surface use case readOrganizationSurface runs',
  'lib/organizations/application/viewer-organization':
    'ensureViewerOrganization, the personal organization the shell falls back to',
  'lib/settings/prefetch-current-user-settings': "The viewer's settings prefetch the shell seeds",
  'lib/sim-links/application/use-cases': 'The Links list use case, prefetched for Links',
  'lib/users/application/read-current-user': "The viewer's profile use case the shell seeds",
  'lib/workflows/application/read-workflow-definition':
    'The workflow definition use case a workspace entry reads to open a workflow',
  'lib/workspaces/application/workspace-shell':
    "The workspace shell use case behind the shell's scope",
  'lib/workspaces/utils':
    'listAccessibleWorkspaceRowsForUser, the workspaces a viewer may open, which Integrations lists',
  'lib/workspaces/visits':
    "The viewer's workspace visit order, which Integrations lists its workspaces in",
  'lib/workspaces/host-context':
    'getWorkspaceHostContextForViewer, who bills a workspace, which the legacy upgrade URL answers with',
  'lib/workspaces/application/viewer-workspaces':
    'listViewerWorkspaces, the workspaces a viewer may open, their default one created first',
  'lib/workspaces/seed-workspace-list': 'The workspace list the shell seeds for the sidebar',
  'lib/catalog/application/list-workspace-apps':
    "The use case that resolves the access policy a workspace's Integrations directory applies",
  'lib/integrations/access':
    "The integration access verdict a workspace's Integrations directory reads from that policy",
  'lib/credentials/application/crud':
    'getWorkspaceCredentialUseCase, which sends an old credential link to its page',
}
/**
 * Host modules every Platform file may import, views included, because the product shares them with
 * the rest of the app. They draw only with shared EMCN. Each entry carries its one-line reason.
 */
const platformHostModules: ReasonedAllowlist = {
  'lib/toast/sink': 'The one toast sink each root connects its own toaster to',
  'components/paste-guard/paste-guard':
    'The one paste admission guard each root mounts, raising its notice through the toast sink',
  'hooks/mothership-chat/desktop-tool-lifetimes': 'The one desktop tool lifetime both apps share',
  'lib/navigation/paths': "The app's path builders",
  'lib/credential-groups/member-integrations-access':
    'canReadMemberIntegrations, the one rule for who has a member integrations inventory',
  'lib/organizations/draft-key':
    'The one persisted key shape for unsent text on an organization surface',
  'lib/navigation/settings-aliases': 'The one table of renamed Settings sections',
  'components/file-viewer/file-viewer':
    'The one file viewer, which the public share page also renders',
  'components/file-viewer/collaboration/file-doc-room':
    "The file viewer's collaborative document room",
  'components/file-viewer/types': "The file viewer's public types",
  'components/file-viewer/rich-markdown-editor/rich-markdown-field':
    'The markdown editor field the file viewer, changelog and workflow notes use',
  'components/file-viewer/rich-markdown-editor/suggestion-list':
    "The markdown editor's / and @ list slot, which the product fills with the composer's suggestions",
  'components/dashboard-panel/dashboard-panel': 'The dashboard panel the markdown editor embeds',
  'components/find-bar/find-bar': 'The one in-page find bar, which the file viewer also renders',
  'components/favicon/favicon':
    "The one site icon, with the shared miss cache, served only through Sim's favicon route",
}

/**
 * Named modules the seam (`lib/data/**` and `shared/`) needs beyond `@/hooks/queries` and `@/lib/api`.
 * The chat hook's own pure modules are among them, so a name under `@/app` or `@/components` is
 * expected; `checkSeamClosure` proves none of them renders legacy UI. Read a module's runtime import
 * closure before adding it.
 */
const seamHelpers: ReasonedAllowlist = {
  ...granted('Chart and dashboard specs, themes and time windows the Dashboards views render', [
    'lib/dashboards/spec',
    'lib/dashboards/time',
    'components/dashboards/search-params',
    'components/dashboards/use-dashboard-time',
  ]),
  ...granted('Pure core utilities (security, storage, config, formatting) with no UI', [
    'lib/core/config/feature-flags-context',
    'lib/core/resource-scope',
    'lib/core/utils/browser-storage',
    'lib/core/utils/react-node-text',
    'lib/core/utils/save-file',
    'lib/core/utils/csv',
    'lib/core/utils/csv-download',
    'lib/core/utils/timezone',
    'lib/core/utils/timezone-picker',
    'lib/core/utils/urls',
    'lib/core/utils/validation',
    'lib/core/config/deployment-shape',
  ]),
  ...granted('File, upload and preview helpers the Files tab shares with the file viewer', [
    'components/file-viewer/rich-markdown-editor/paste-admission',
    'components/file-viewer/rich-markdown-editor/round-trip-safety',
    'hooks/use-workspace-files-room',
    'components/file-viewer/file-category',
    'components/file-viewer/search-params',
    'components/file-viewer/untitled-title',
    'hooks/use-profile-picture-upload',
    'lib/uploads/client/admission',
    'lib/uploads/shared/assistant-images',
    'lib/uploads/shared/types',
    'lib/uploads/utils/file',
    'lib/uploads/utils/validation',
    'lib/workspace-files/browser',
    'lib/workspace-files/page-content-type',
    'stores/in-flight-uploads/store',
    'lib/uploads/utils/file-size',
    'lib/uploads/client/download',
    'lib/uploads/client/logo-file',
  ]),
  ...granted(
    'The chat hook and the pure modules around it, which the Platform drives rather than forks',
    [
      'lib/mothership/chat/live-message-id',
      'lib/mothership/chat/selection-clipboard',
      'components/find-bar/use-find-shortcut',
      'components/mothership-chat/message-content/components/agent-group/agent-group-view',
      'components/mothership-chat/message-content/components/agent-group/lane-activity',
      'components/mothership-chat/message-content/components/agent-group/tool-activity-labels',
      'components/mothership-chat/message-content/components/question/answers',
      'components/mothership-chat/message-content/components/special-tags/credential-workspace-context',
      'components/mothership-chat/message-content/components/special-tags/use-oauth-chip-connection',
      'components/mothership-chat/message-content/parse-blocks',
      'components/mothership-chat/message-content/resolve-citations',
      'components/mothership-chat/message-content/tool-status',
      'hooks/mothership-chat/use-chat',
      'hooks/mothership-chat/use-browser-tab-resources',
      'hooks/mothership-chat/use-terminal-tab-resources',
      'hooks/mothership-chat/use-resource-panel',
      'hooks/mothership-chat/preview/use-file-preview-sessions',
      'hooks/mothership-chat/use-restored-chat-entry',
      'components/workflow-editor/components/panel/components/copilot/components/user-input/hooks/use-file-attachments',
      'components/assistant-actions/presentation',
      'hooks/use-computer-use-status',
      'hooks/use-mothership-chat-events',
      'hooks/use-voice-input',
      'lib/mothership/chat/attachment-preview',
      'lib/mothership/chat/context',
      'lib/mothership/chat/search-params',
      'lib/mothership/chat/special-tags',
      'lib/mothership/chat/types',
      'lib/mothership/generated/resources',
      'lib/mothership/generated/tool-catalog-v1',
      'lib/mothership/model-options',
      'lib/mothership/resources/search',
      'lib/mothership/resources/types',
      'lib/mothership/tools/activity',
      'lib/mothership/tools/display',
      'lib/execution/remote-sandbox/cli-tools',
      'lib/terminal/focus',
      'lib/terminal/resource-id',
      'lib/terminal/transport',
      'lib/browser-agent/panel-occlusion',
      'lib/browser-agent/transport',
      'stores/mothership-drafts/store',
      'stores/mothership-effort/store',
      'stores/tool-permission/store',
      'stores/browser-session/store',
      'stores/copilot-terminal/store',
      'tools/assistant-effects',
      'lib/mothership/chat/source-link',
      'lib/knowledge/search/source-url',
      'lib/assistant-actions/providers',
    ]
  ),
  ...granted(
    'Integration, credential and connector models the Integrations and Search pages read; pure, with no UI',
    [
      'lib/slack-search/manifest',
      'lib/slack-search/onboarding',
      'lib/integrations/slack-manifest',
      'connectors/auth',
      'connectors/gitlab/permission-config/csv-files',
      'connectors/gitlab/permission-config/use-permission-form',
      'connectors/registry',
      'connectors/types',
      'lib/webhooks/trigger-url',
      'hooks/kb/connectors/sync-state',
      'hooks/kb/connectors/use-connector-access-field',
      'hooks/kb/connectors/use-connector-actions',
      'hooks/kb/connectors/use-connector-config-fields',
      'hooks/kb/connectors/use-connector-selector',
      'hooks/use-credential-refresh-triggers',
      'hooks/use-search-integration-connection',
      'lib/knowledge/connectors/access-fields',
      'lib/knowledge/connectors/access-modes',
      'lib/knowledge/connectors/entitlements',
      'lib/knowledge/connectors/sync-limits',
      'lib/knowledge/search/connection-target',
      'lib/knowledge/search/results',
      'lib/sim-search/connectors',
      'lib/sim-search/connection-labels',
      'lib/sim-search/constants',
      'lib/sim-search/live/source-settings',
      'lib/sim-search/source-identity',
      'lib/sim-search/live/source-catalog',
      'lib/sim-search/params',
      'lib/credential-groups/limits',
      'lib/credential-groups/slack-managed-user-scopes',
      'lib/oauth/github-installation-types',
      'hooks/use-github-installation-setup',
      'stores/connector-setup/store',
      'lib/credential-groups/managed-mcp-connectors',
      'lib/credential-groups/member-integrations',
      'lib/sim-search/live/provider-catalog',
      'lib/sim-search/live/policy-schema',
      'lib/organization-secrets/validation',
      'lib/integrations/credential-display',
      'lib/credential-groups/search-readiness',
      'lib/credential-groups/providers',
      'lib/credential-groups/credential-types',
      'hooks/use-oauth-return',
      'lib/oauth/utils',
    ]
  ),
  ...granted(
    "Organization, People, Links, Settings and workspace models and URL params the product's pages read",
    [
      'lib/organizations/search-params',
      'lib/organizations/integrations-search-params',
      'hooks/use-resource-list-preferences',
      'hooks/use-user-permissions',
      'lib/settings/search-params',
      'lib/settings/section-availability',
      'stores/folders/types',
      'stores/organization-home/store',
      'hooks/use-seed-deployment-shape',
      'hooks/use-settings-browser-navigation',
      'hooks/use-settings-leave-links',
      'hooks/use-settings-unsaved-guard',
      'hooks/use-settings-search',
      'hooks/use-url-sort',
      'lib/url-state/constants',
      'lib/branding',
      'lib/favicon/url',
      'lib/help-links',
      'lib/help/request',
      'lib/invitations/error-messages',
      'lib/messaging/email/validation',
      'lib/navigation/paths',
      'lib/organizations/personal-accounts',
      'lib/people/read-sheet',
      'lib/people/search-params',
      'lib/people/validation',
      'lib/sim-links/search-params',
      'lib/sim-links/urls',
      'lib/sim-links/validation',
      'lib/url-state',
      'lib/workspaces/permissions/role-lock',
      'stores/settings/dirty/store',
    ]
  ),
  ...granted('Knowledge base models and upload and tag hooks the Knowledge tab runs', [
    'components/knowledge/base/components/consts',
    'hooks/knowledge/use-knowledge-upload',
    'components/knowledge/search-params',
    'hooks/kb/use-knowledge',
    'lib/chunkers/constants',
    'lib/tokenization/accurate',
    'lib/knowledge/constants',
    'lib/knowledge/documents/types',
    'lib/knowledge/filters/types',
    'lib/knowledge/types',
  ]),
  ...granted('Table grid logic, column types and query builder the Tables tab runs', [
    'components/tables/components/table-grid/table-paste',
    'components/tables/components/table-grid/types',
    'components/tables/components/table-grid/utils',
    'components/tables/components/timezone-editing',
    'components/tables/hooks/use-table-event-stream',
    'components/tables/lock-copy',
    'components/tables/types',
    'components/tables/utils',
    'hooks/use-workspace-tables-room',
    'components/tables/list/search-params',
    'hooks/use-table-undo',
    'lib/table/column-keys',
    'lib/table/column-naming',
    'lib/table/column-types',
    'lib/table/constants',
    'lib/table/currency',
    'lib/table/dates',
    'lib/table/deps',
    'lib/table/query-builder/cell-filter',
    'lib/table/query-builder/constants',
    'lib/table/query-builder/converters',
    'lib/table/ttl-values',
    'lib/table/types',
    'lib/table/workflow-groups/deployment-mode',
    'stores/table/types',
  ]),
  ...granted(
    "The Workflows list's realtime room, which keeps the list current while others edit it",
    ['hooks/use-workspace-workflows-room']
  ),
  ...granted(
    'Workflow, block, tool and log metadata the product reads without rendering the editor',
    [
      'enrichments/registry',
      'enrichments/types',
      'lib/block-metadata/names.generated',
      'lib/selectors/manifest',
      'lib/logs/execution/trace-spans/trace-spans',
      'lib/resources',
      'lib/workflows/input-format',
      'lib/workflows/types',
      'stores/panel',
      'stores/workflows/registry/types',
      'stores/workflows/workflow/types',
      'tools/metadata',
      'tools/normalize',
      'lib/data-drains/types',
      'lib/guardrails/custom-patterns',
      'lib/guardrails/pii-entities',
      'lib/logs/time-range',
      'lib/logs/get-trigger-options',
      'lib/permission-groups/features',
      'lib/permission-groups/fields',
      'lib/permission-groups/model-gate',
      'providers/model-lookup',
      'stores/logs/filters/types',
    ]
  ),
  ...granted(
    "Enterprise settings hooks, form models and URL params the organization's Settings sections run",
    [
      'ee/access-control/hooks/permission-groups',
      'ee/access-control/lib/editor',
      'ee/access-control/search-params',
      'ee/access-requests/components/search-params',
      'ee/access-requests/components/status',
      'ee/access-requests/lib/navigation',
      'ee/access-requests/lib/policy-description',
      'ee/access-requests/lib/targets',
      'ee/audit-logs/constants',
      'ee/audit-logs/hooks/audit-logs',
      'ee/audit-logs/lib/format',
      'ee/audit-logs/lib/scope',
      'ee/audit-logs/search-params',
      'ee/data-drains/destinations/specs',
      'ee/data-drains/hooks/data-drains',
      'ee/data-drains/labels',
      'ee/data-retention/hooks/data-retention',
      'ee/data-retention/lib/policy-draft',
      'ee/organization-usage/constants',
      'ee/organization-usage/format',
      'ee/organization-usage/hooks/use-usage-window',
      'ee/organization-usage/search-params',
      'ee/scim/components/options',
      'ee/scim/hooks/scim',
      'ee/scim/lib/group-mapping-view',
      'ee/session-policy/hooks/session-policy',
      'ee/session-policy/lib/policy-form',
      'ee/sso/constants',
      'ee/sso/hooks/domains',
      'ee/sso/hooks/sso',
      'ee/sso/hooks/sso-policy',
      'ee/sso/lib/provider-form',
      'ee/sso/search-params',
      'ee/whitelabeling/form',
      'ee/whitelabeling/hooks/whitelabel',
      'ee/workspace-forking/components/fork-sync/cleared-refs-list',
      'ee/workspace-forking/components/fork-sync/copy-reconciliation',
      'ee/workspace-forking/components/fork-sync/custom-block-input-control',
      'ee/workspace-forking/components/fork-sync/dependent-field-noun',
      'ee/workspace-forking/components/fork-sync/dependent-value',
      'ee/workspace-forking/components/fork-sync/use-fork-sync',
      'ee/workspace-forking/hooks/background-work',
      'ee/workspace-forking/hooks/use-forking-available',
      'ee/workspace-forking/hooks/workspace-fork',
      'ee/workspace-forking/lib/promote/sync-blockers',
      'ee/access-requests/lib/navigation',
    ]
  ),
  ...granted('Generic client hooks with no UI of their own', [
    'hooks/use-autosave',
    'hooks/use-before-unload-while',
    'hooks/use-capture-when-ready',
    'hooks/use-debounce',
    'hooks/use-debounced-search-setter',
    'hooks/use-inline-rename',
    'hooks/use-is-mobile',
    'hooks/use-search-filter-value',
    'hooks/use-hydrated',
    'hooks/use-client-stored',
    'hooks/admin/use-recent-impersonations',
  ]),
  ...granted('Desktop bridge helpers the product shares with the desktop app', [
    'hooks/use-desktop-preference-mutation',
    'hooks/use-desktop-update-gate',
    'hooks/use-desktop-update-state',
    'lib/desktop',
    'lib/desktop/appearance',
    'lib/desktop/chat-scope',
    'lib/desktop/panel-focus',
    'lib/desktop/source-connect',
  ]),
  ...granted('Billing plan, usage and upgrade models the Billing and usage pages read', [
    'lib/billing/upgrade-reasons',
    'lib/billing/usage-sources',
    'lib/billing/client/utils',
    'lib/billing/client/billing-scope',
    'lib/billing/client/plan-view',
    'lib/billing/client/upgrade-state',
    'lib/billing/constants',
    'lib/billing/plan-comparison',
    'lib/billing/plan-configs',
    'lib/billing/core/organization-activity',
    'lib/billing/credits/conversion',
    'lib/billing/invoices',
    'lib/billing/on-demand',
    'lib/billing/plan-helpers',
    'lib/billing/subscription-permissions',
    'lib/billing/subscriptions/utils',
    'lib/billing/usage-limit-draft',
  ]),
  ...granted('Analytics, consent and telemetry clients every root loads', [
    'lib/posthog/client',
    'lib/consent/copy',
    'lib/telemetry/browser-preference',
  ]),
  ...granted("The browser auth client and session context the product's client shell reads", [
    'lib/auth/browser-storage',
    'lib/auth/client',
    'lib/auth/oauth-provider',
    'lib/auth/session-context',
    'lib/auth/session-expiry',
    'lib/auth/session-provider',
  ]),
  ...granted(
    'The identity-boundary reset sign-out and account deletion run: stops running desktop tools, then loads the store reset lazily.',
    ['stores']
  ),
  ...granted(
    'Model provider brand glyphs the Usage breakdown shows, which live outside the icon barrel.',
    ['components/icons/nebius', 'components/icons/thinking-machines']
  ),
  ...granted(
    "Workspace Secrets and BYOK settings: the secrets editor's row helpers and record writes, credential-sharing email resolution and the provider brand glyphs.",
    [
      'components/icons',
      'components/secrets/secret-rows',
      'lib/core/utils/records',
      'lib/workspaces/sharing',
    ]
  ),
  ...granted(
    "The workflow editor's logic, re-exported by `lib/data/workflows` for the ported canvas views.",
    [
      'app/_styles/fonts/season/season',
      'components/settings/settings-navigation-provider',
      'lib/billing/workspace-permissions',
      'components/workspace-providers/block-visibility-loader',
      'components/workspace-providers/provider-models-loader',
      'components/workspace-providers/settings-loader',
      'components/workspace-providers/workflow-scope-provider',
      'components/workspace-providers/workspace-permissions-provider',
      'components/workspace-providers/workspace-scope-sync',
      'lib/global-commands/commands',
      'components/workflow-editor/components/search-replace/hooks/use-workflow-resource-replacement-options',
      'components/workflow-editor/components/search-replace/hooks/use-workflow-search-reference-hydration',
      'components/workflow-editor/components/subflows/loop/loop-config',
      'components/workflow-editor/components/subflows/parallel/parallel-config',
      'components/workflow-editor/components/workflow-block/hooks/use-block-properties',
      'components/workflow-editor/components/workflow-block/hooks/use-block-state',
      'components/workflow-editor/components/workflow-block/hooks/use-child-workflow',
      'components/workflow-editor/components/workflow-block/hooks/use-webhook-info',
      'components/workflow-editor/components/workflow-block/types',
      'components/workflow-editor/components/workflow-block/utils',
      'components/workflow-editor/hooks/float',
      'components/workflow-editor/hooks/use-auto-layout',
      'components/workflow-editor/hooks/use-block-current-workflow',
      'components/workflow-editor/hooks/use-block-dimensions',
      'components/workflow-editor/hooks/use-canvas-context-menu',
      'components/workflow-editor/hooks/use-current-workflow',
      'components/workflow-editor/hooks/use-dynamic-handle-refresh',
      'components/workflow-editor/hooks/use-execution-handoff',
      'components/workflow-editor/hooks/use-node-utilities',
      'components/workflow-editor/hooks/use-prevent-zoom',
      'components/workflow-editor/hooks/use-shift-selection-lock',
      'components/workflow-editor/hooks/use-workflow-execution',
      'components/workflow-editor/search-params',
      'components/workflow-editor/utils/block-protection',
      'components/workflow-editor/utils/edge-highlight',
      'components/workflow-editor/utils/node-position',
      'components/workflow-editor/utils/run-from-block',
      'components/workflow-editor/utils/workflow-canvas-helpers',
      'lib/search/fuzzy',
      'hooks/workflow-actions/use-can-delete',
      'hooks/workflow-actions/use-delete-selection',
      'hooks/workflow-actions/use-export-selection',
      'hooks/workflow-actions/use-export-workflow',
      'components/workspace-providers/socket-provider',
      'blocks',
      'blocks/custom/build-config',
      'blocks/custom/client-overlay',
      'blocks/registry',
      'blocks/types',
      'executor/constants',
      'hooks/mcp/use-mcp-tools',
      'hooks/use-canvas-viewport',
      'hooks/use-collaborative-workflow',
      'hooks/use-operation-access',
      'hooks/use-permission-config',
      'hooks/use-reactive-conditions',
      'hooks/use-sandbox-block-constraints',
      'hooks/use-selector-display-name',
      'lib/core/utils/platform',
      'lib/credentials/client-state',
      'lib/credentials/display-name',
      'lib/mcp/shared',
      'lib/mothership/events',
      'lib/oauth',
      'lib/permission-groups/operation-access',
      'lib/workflows/autolayout/constants',
      'lib/workflows/blocks/canvas-card-fields',
      'lib/workflows/blocks/canvas-ports',
      'lib/workflows/blocks/canvas-presentation',
      'lib/workflows/blocks/canvas-rows',
      'lib/workflows/blocks/canvas-sentence',
      'lib/workflows/blocks/canvas-trigger-sentence',
      'lib/workflows/blocks/code-preview',
      'lib/workflows/blocks/deterministic-dimensions',
      'lib/workflows/blocks/flatten-outputs',
      'lib/workflows/blocks/search-index',
      'lib/workflows/comparison',
      'lib/workflows/dynamic-handle-topology',
      'lib/workflows/layout',
      'lib/workflows/notes/add-image',
      'lib/workflows/notes/canvas-requests',
      'lib/workflows/operations/import-export',
      'lib/workflows/search-replace/indexer',
      'lib/workflows/search-replace/replacements',
      'lib/workflows/search-replace/resources',
      'lib/workflows/search-replace/state',
      'lib/workflows/search-replace/subflow-fields',
      'lib/workflows/search-replace/types',
      'lib/workflows/subblocks/dependencies',
      'lib/workflows/subblocks/display',
      'lib/workflows/subblocks/visibility',
      'lib/workflows/triggers/input-definition-triggers',
      'lib/workflows/triggers/triggers',
      'lib/workflows/triggers/utils',
      'lib/workspaces/colors',
      'lib/workspaces/naming',
      'providers/models',
      'stores/canvas-mode',
      'stores/constants',
      'stores/execution',
      'stores/modals/variables/store',
      'stores/panel/editor/store',
      'stores/panel/toolbar/store',
      'stores/presence/store',
      'stores/undo-redo',
      'stores/variables/store',
      'stores/workflow-search-replace/store',
      'stores/workflows',
      'stores/workflows/prepare-block-state',
      'stores/workflows/registry/store',
      'stores/workflows/registry/utils',
      'stores/workflows/subblock/store',
      'stores/workflows/utils',
      'stores/workflows/workflow/store',
      'stores/workflows/state-port/connect-stores',
      'tools/params',
      'triggers/registry',
    ]
  ),
  ...granted(
    "The block editor's sub-block logic, re-exported by `lib/data/workflow-editor` for its inputs.",
    [
      'components/custom-tool-editor/custom-tool-schema',
      'components/custom-tool-editor/use-custom-tool-generation',
      'components/integrations/connect-service-account-modal/use-service-account-connect',
      'components/settings/sections/sandboxes/utils',
      'lib/skills/authoring',
      'lib/skills/copy',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/components/combobox/missing-option',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/components/credential-selector/microsoft-dataverse-policy',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/components/dropdown/stale-selections',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/components/tool-input/param-dependents',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/components/tool-input/utils',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-canonical-sub-block-value',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-dependency-block-type',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-fetched-options',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-mcp-block-config',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-resource-folders',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-selector-setup',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
      'components/workflow-editor/components/panel/components/editor/components/sub-block/utils',
      'components/workflow-editor/components/panel/components/editor/hooks/use-editor-block-properties',
      'components/workflow-editor/components/panel/components/editor/hooks/use-editor-subblock-layout',
      'components/workflow-editor/hooks/use-accessible-reference-prefixes',
      'components/workflow-editor/hooks/use-wand',
      'components/workflow-editor/hooks/workflow-reference-scope',
      'blocks/utils',
      'components/mcp/target-options',
      'executor/utils/builder-data',
      'executor/utils/reference-validation',
      'hooks/kb/use-knowledge-base-tag-definitions',
      'hooks/kb/use-tag-selection',
      'hooks/mcp/use-mcp-oauth-popup',
      'hooks/use-available-env-vars',
      'hooks/use-code-undo-redo',
      'hooks/use-settings-navigation',
      'hooks/use-webhook-management',
      'lib/credential-groups/managed-mcp-connector-icons',
      'lib/credentials/client-credential-accounts/descriptors',
      'lib/credentials/config-service-accounts/descriptors',
      'lib/credentials/service-account-provider-ids',
      'lib/credentials/token-service-accounts/descriptors',
      'lib/execution/languages',
      'lib/folders/paths',
      'lib/folders/selection',
      'lib/mcp/operation-policy',
      'lib/mcp/output-schema',
      'lib/mcp/tool-validation',
      'lib/mcp/types',
      'lib/mcp/workflow-config',
      'lib/oauth/microsoft-dataverse',
      'lib/table/hooks/use-table-columns',
      'lib/table/query-builder/use-query-builder',
      'lib/workflows/blocks/fallback-models',
      'lib/workflows/blocks/outputs',
      'lib/workflows/blocks/reference-tags',
      'lib/workflows/blocks/retry-eligibility',
      'lib/workflows/conditions',
      'lib/workflows/labels',
      'lib/workflows/sanitization/references',
      'lib/workflows/schedules/utils',
      'lib/workflows/streaming/nested-output-options',
      'lib/workflows/streaming/output-selector',
      'lib/workflows/tool-input/param-visibility',
      'lib/workflows/tool-input/synthetic-subblocks',
      'lib/workflows/tool-input/types',
      'lib/workflows/tool-input/usage-control',
      'lib/workspace-files/folder-display-path',
      'lib/workspace-files/folder-path-selection',
      'lib/workspace-files/selection',
      'stores/providers/store',
      'stores/variables/types',
      'tools/param-shape',
      'triggers/constants',
      'triggers/slack/capabilities',
      'lib/oauth/types',
    ]
  ),
  ...granted(
    "The editor Terminal's logic, re-exported by `lib/data/workflow-deploy/terminal` for its views.",
    [
      'components/workflow-editor/components/terminal/hooks/use-terminal-filters',
      'components/workflow-editor/components/terminal/utils',
      'hooks/use-code-viewer',
      'lib/core/utils/user-file',
      'lib/execution/payloads/large-array-manifest-metadata',
      'lib/execution/payloads/large-value-ref',
      'stores/terminal',
    ]
  ),
  ...granted(
    "The deploy surfaces' logic, re-exported by `lib/data/workflow-deploy` for the deploy views.",
    [
      'components/workflow-editor/components/panel/components/deploy/components/deploy-modal/components/chat/hooks/use-identifier-validation',
      'components/workflow-editor/components/panel/components/deploy/components/deploy-modal/components/chat/utils',
      'components/workflow-editor/components/panel/components/deploy/components/deploy-modal/components/general/compare-pair',
      'components/workflow-editor/components/panel/components/deploy/components/deploy-modal/components/general/format-version-label',
      'components/workflow-editor/components/panel/components/deploy/hooks/deploy-action-lock',
      'components/workflow-editor/components/panel/components/deploy/hooks/predeploy-checks',
      'components/workflow-editor/components/panel/components/deploy/hooks/use-deploy-readiness',
      'components/workflow-editor/components/panel/components/deploy/hooks/use-deployment',
      'components/workflow-editor/components/panel/components/deploy/hooks/use-deployment-view-state',
      'components/workflow-editor/components/panel/components/deploy/hooks/use-draft-workflow-state',
      'components/workflow-editor/workflow-diff/components/change-list/ordered-row-diff',
      'components/workflow-editor/workflow-diff/components/change-list/text-diff-lines',
      'components/workflow-editor/workflow-diff/components/change-list/value-presentation',
      'components/workflow-editor/workflow-diff/utils',
      'lib/chat-deployments/urls',
      'lib/mcp/workflow-tool-schema',
      'lib/workflows/comparison/compare',
      'lib/workflows/comparison/resolve-values',
      'lib/workflows/operations/deployment-utils',
      'lib/workflows/streaming/agent-stream-protocol',
      'stores/workflows/sync-local-draft',
    ]
  ),
}
/** App `.tsx` outside the Platform that the seam's closure may reach: providers and glyphs, not a surface. */
const seamClosureViews: ReasonedAllowlist = {
  'app/_shell/providers/query-provider.tsx':
    "The app's one React Query client, which every seam hook reads through",
  'components/workspace-providers/socket-provider.tsx':
    'The one realtime socket the workspace tabs and the workflow editor share',
  'components/icons.tsx': 'The glyph set block configs name their icons from',
  'components/icons/nebius.tsx': 'A model provider glyph the Usage breakdown shows',
  'components/icons/thinking-machines.tsx': 'A model provider glyph the Usage breakdown shows',
}
/**
 * What the workflow seam's closure may reach beyond `seamClosureViews`: the editor's context
 * providers and loaders, which render nothing of their own.
 */
const workflowClosureViews: ReasonedAllowlist = granted(
  'A workflow editor context provider or loader the Workflows tab runs unchanged; it renders nothing of its own',
  [
    'components/workspace-providers/block-visibility-loader.tsx',
    'components/workspace-providers/provider-models-loader.tsx',
    'components/workspace-providers/settings-loader.tsx',
    'components/workspace-providers/workflow-scope-provider.tsx',
    'components/workspace-providers/workspace-permissions-provider.tsx',
    'components/workspace-providers/workspace-scope-sync.tsx',
    'components/workflow-editor/hooks/workflow-reference-scope.tsx',
    'components/settings/settings-navigation-provider.tsx',
  ]
)

/** Live-only product pages, which answer not found on a fixture build, and why each has no fixture. */
const LIVE_ONLY_ROUTES: ReasonedAllowlist = {
  [`${ORGANIZATION_ROUTES}integrations/accounts/[credentialId]/page.tsx`]:
    "A connected account's detail exists only for a live credential",
  [`${ORGANIZATION_ROUTES}people/[memberId]/page.tsx`]:
    'People reads the live roster and has no example data',
  [`${ORGANIZATION_ROUTES}people/page.tsx`]: 'People reads the live roster and has no example data',
  [`${ORGANIZATION_ROUTES}search/chat/[id]/page.tsx`]:
    'Search answers from live sources and has no example data',
  [`${ORGANIZATION_ROUTES}search/page.tsx`]:
    'Search answers from live sources and has no example data',
  [`${ORGANIZATION_ROUTES}settings/billing/plans/page.tsx`]:
    "Plans read the organization's live subscription",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/upgrade/page.tsx`]:
    "Who manages a workspace's plan is read from its live billing",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/files/[fileId]/page.tsx`]:
    "Files reads the workspace's live storage",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/files/page.tsx`]:
    "Files reads the workspace's live storage",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/page.tsx`]:
    "Knowledge reads the workspace's live knowledge bases",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/[knowledgeBaseId]/page.tsx`]:
    "Knowledge reads the workspace's live knowledge bases",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/knowledge/page.tsx`]:
    "Knowledge reads the workspace's live knowledge bases",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/tables/[tableId]/page.tsx`]:
    "Tables read the workspace's live rows",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/tables/page.tsx`]:
    "Tables read the workspace's live rows",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/tests/[name]/page.tsx`]:
    "Tests run the workspace's live workflows",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/tests/page.tsx`]:
    "Tests run the workspace's live workflows",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/[workflowId]/page.tsx`]:
    'The Workflows tab edits live workflow state and has no example data',
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/[workflowId]/versions/[version]/page.tsx`]:
    'The Workflows tab edits live workflow state and has no example data',
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/page.tsx`]:
    'The Workflows tab edits live workflow state and has no example data',
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/runs/[executionId]/page.tsx`]:
    'The Workflows tab edits live workflow state and has no example data',
}
/** Views that branch on fixture mode, which only pages, layouts, registries and fixtures may. */
const FIXTURE_BRANCH_VIEWS: ReasonedAllowlist = {
  'platform/lib/navigation.ts':
    'platformHref keeps fixture scenario params on links only in a fixture build, inlined at build time',
  'platform/lib/platform-href.ts':
    'usePlatformHref reads the query string only in a fixture build, chosen when the app is built',
  [`${PRODUCT_ROUTES}_components/product-shell.tsx`]:
    'The one product shell picks the fixture or live session around every page',
  'platform/lib/data/billing.ts':
    'The billing adapter swaps cancel and restore for the fixture settings context and hides portal and invoice links',
  'platform/lib/data/members.ts':
    'The members adapter leaves to fixture Home and keeps the billing portal unavailable under the fixture settings context',
  'platform/lib/data/settings-providers.tsx':
    'Owns the fixture settings context itself and its session-lifetime drafts',
  'platform/lib/data/preferences.ts':
    'The telemetry setting never touches the browser telemetry preference on a fixture preview',
}

/**
 * Files outside the Platform tree that style, spread or set variant attributes on an EMCN element
 * (`prop-spread`, `consumer-style`). Each predates the repo-wide rule and is the design owner's.
 */
const EMCN_CONSUMER_OVERRIDES: ReasonedAllowlist = {
  ...granted(
    "The docs app sizes and tints EMCN's Icon with utility classes; design-owner code that predates the repo-wide rule",
    [
      '../docs/components/docs/api-schema/api-schema.tsx',
      '../docs/components/docs/article/article.tsx',
      '../docs/components/docs/feedback/feedback.tsx',
      '../docs/components/docs/gallery/gallery.tsx',
      '../docs/components/docs/navigation-drawer/navigation-drawer.tsx',
      '../docs/components/docs/navigation/navigation.tsx',
      '../docs/components/docs/page-actions/page-actions.tsx',
      '../docs/components/docs/page-frame/page-frame.tsx',
      '../docs/components/docs/search/search.tsx',
      '../docs/components/docs/sim-logo/sim-logo.tsx',
      '../docs/components/docs/table-of-contents/table-of-contents.tsx',
      '../docs/components/docs/theme/theme.tsx',
    ]
  ),
  ...granted(
    "The Auth and Docs packages compose EMCN's Icon with their own classes; design-owner code that predates the repo-wide rule",
    [
      '../../packages/emcn-auth/src/components/input/input.tsx',
      '../../packages/emcn-docs/src/components/callout/callout.tsx',
      '../../packages/emcn-docs/src/components/cards/cards.tsx',
      '../../packages/emcn-docs/src/components/copy-button/copy-button.tsx',
      '../../packages/emcn-docs/src/components/heading/heading.tsx',
      '../../packages/emcn-docs/src/components/lightbox/lightbox.tsx',
      '../../packages/emcn-docs/src/components/reference-details/reference-details.tsx',
      '../../packages/emcn-docs/src/components/tabs/tabs.tsx',
    ]
  ),
  'app/(auth)/oauth/consent/consent-view.tsx':
    "The OAuth consent view sizes a scope row's Icon with auth utilities; design-owner code that predates the repo-wide rule",
}

/**
 * Views that ask with a hand-built confirm `Modal` (`confirm-owner`). `ConfirmDialog` has no cancel
 * label, so only a question whose refusal is its own answer, named by the page, keeps the Modal.
 */
const CONFIRM_OWNERS: ReasonedAllowlist = {
  [`${PRODUCT_ROUTES}_components/chat/panel/browser-session/page-prompts.tsx`]:
    "A page's leave and permission prompts answer Stay or Block, which ConfirmDialog's Cancel cannot say",
}

/** Views with a hand-built back button (`back-owner`), each held for its design owner. */
const BACK_OWNERS: ReasonedAllowlist = {
  ...granted(
    "People's tab and header are hand-built for the design owner's pass (P8 people-frame)",
    [
      `${ORGANIZATION_ROUTES}people/_components/directory-sync/directory-sync-page.tsx`,
      `${ORGANIZATION_ROUTES}people/_components/person/person.tsx`,
    ]
  ),
}

/**
 * Views with hand-built tabs (`tab-owner`). `ContentTabs` unmounts a hidden panel and lays out its
 * own header, and EMCN is frozen, so a tab set it cannot express keeps its roles here.
 */
const TAB_OWNERS: ReasonedAllowlist = {
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/right-panel/right-panel.tsx`]:
    'Toolbar, Editor and Variables stay mounted while hidden, as legacy keeps their state; ContentTabs unmounts them',
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/workflows/_components/terminal/output-panel/output-panel.tsx`]:
    'Output and Input switch one shared viewer from a header that expands the panel; ContentTabs owns separate panels and its header',
}

/** Views with a hand-built `role='alert'` (`alert-owner`), where no EMCN owner fits the message. */
const ALERT_OWNERS: ReasonedAllowlist = {
  [`${PRODUCT_ROUTES}_components/organization-menu/organization-menu.tsx`]:
    "The menu's inline rename Input names this message in its describedBy; a TextField would add a visible label row",
  [`${PRODUCT_ROUTES}_components/secrets-editor/secret-row.tsx`]:
    "A secret row's message spans the row's grid of bare Inputs, which have no error slot; InlineNotice cannot take that grid placement",
  [`${PRODUCT_ROUTES}workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-editor.tsx`]:
    "The schema and code editors have no error slot; their message sits inline in the editor's action bar beside Generate",
}

export const PLATFORM_ALLOWLISTS = {
  LIVE_ONLY_ROUTES,
  FIXTURE_BRANCH_VIEWS,
  CODE_FIRST_VARIANTS,
  UNEXPORTED_VARIANT_OWNERS,
  EMCN_CONSUMER_OVERRIDES,
  LOADING_COPY_OWNERS,
  HELPER_COPY_OWNERS,
  CONFIRM_OWNERS,
  BACK_OWNERS,
  TAB_OWNERS,
  ALERT_OWNERS,
  FRAMES_OUTSIDE_SURFACE,
  LOCAL_TOKEN_OWNERS,
  ROW_BLEED_OWNERS,
  serverSeamHelpers,
  platformHostModules,
  seamHelpers,
  seamClosureViews,
  workflowClosureViews,
} satisfies Record<string, ReasonedAllowlist>

export type AllowlistName = keyof typeof PLATFORM_ALLOWLISTS
export type PlatformAllowlists = Readonly<Record<AllowlistName, ReasonedAllowlist>>

/** The entries of each named allowlist whose reason is missing or spans more than one line. */
export function allowlistReasonFindings(
  allowlists: Readonly<Record<string, ReasonedAllowlist>>
): string[] {
  const findings: string[] = []
  for (const [name, entries] of Object.entries(allowlists)) {
    for (const [entry, reason] of Object.entries(entries)) {
      if (typeof reason !== 'string' || !reason.trim()) {
        findings.push(`${name} grants ${entry} without a reason`)
      } else if (/[\r\n]/.test(reason)) {
        findings.push(`${name} gives ${entry} a reason longer than one line`)
      }
    }
  }
  return findings
}

/**
 * The entries no check consulted: each grants an exception nothing needs any more. `consulted` holds,
 * per allowlist, the entries a check relied on to pass something it would otherwise report.
 */
export function staleAllowlistFindings(
  allowlists: Readonly<Record<string, ReasonedAllowlist>>,
  consulted: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  const findings: string[] = []
  for (const [name, entries] of Object.entries(allowlists)) {
    for (const entry of Object.keys(entries)) {
      if (!consulted.get(name)?.has(entry))
        findings.push(`${name} names ${entry}, which no check needed; delete the entry`)
    }
  }
  return findings
}
