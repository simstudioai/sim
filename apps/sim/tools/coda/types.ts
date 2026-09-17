import type { ToolResponse } from '@/tools/types'

export interface CodaAuthParams {
  accessToken: string
}

export interface CodaPaginationParams {
  limit?: number
  pageToken?: string
}

export interface CodaDocParams extends CodaAuthParams {
  docId: string
}

export interface CodaPageParams extends CodaDocParams {
  pageId: string
}

export interface CodaTableParams extends CodaDocParams {
  tableId: string
}

export interface CodaRowParams extends CodaTableParams {
  rowId: string
}

export interface CodaIcon {
  name: string | null
  type: string | null
  browserLink: string | null
}

export interface CodaPerson {
  name: string | null
  email: string | null
}

export interface CodaPageRef {
  id: string
  name: string | null
  href: string | null
  browserLink: string | null
}

export interface CodaTableRef {
  id: string
  name: string | null
  tableType: string | null
  href: string | null
  browserLink: string | null
}

export interface CodaWorkspaceRef {
  id: string
  name: string | null
  organizationId: string | null
  browserLink: string | null
}

export interface CodaDoc {
  id: string
  name: string
  href: string
  browserLink: string
  icon: CodaIcon | null
  owner: string | null
  ownerName: string | null
  createdAt: string | null
  updatedAt: string | null
  workspace: CodaWorkspaceRef | null
  folder: { id: string; name: string | null; browserLink: string | null } | null
  sourceDoc: { id: string; href: string | null; browserLink: string | null } | null
  docSize: {
    totalRowCount: number | null
    tableAndViewCount: number | null
    baseTableCount: number | null
    pageCount: number | null
    overApiSizeLimit: boolean | null
  } | null
  published: {
    description: string | null
    browserLink: string | null
    imageLink: string | null
    discoverable: boolean | null
    earnCredit: boolean | null
    mode: string | null
    categories: string[]
  } | null
}

export interface CodaPage {
  id: string
  name: string
  subtitle: string | null
  href: string
  browserLink: string
  contentType: string | null
  isHidden: boolean | null
  isEffectivelyHidden: boolean | null
  icon: CodaIcon | null
  image: {
    browserLink: string | null
    type: string | null
    width: number | null
    height: number | null
  } | null
  parent: CodaPageRef | null
  children: CodaPageRef[]
  authors: CodaPerson[]
  createdAt: string | null
  createdBy: CodaPerson | null
  updatedAt: string | null
  updatedBy: CodaPerson | null
}

export interface CodaTableReference {
  id: string
  name: string
  tableType: string | null
  href: string
  browserLink: string
  parent: CodaPageRef | null
}

export interface CodaTable extends CodaTableReference {
  parentTable: CodaTableRef | null
  displayColumnId: string | null
  rowCount: number | null
  sorts: Array<{ columnId: string | null; direction: string | null }>
  layout: string | null
  filter: {
    valid: boolean | null
    isVolatile: boolean | null
    hasUserFormula: boolean | null
    hasTodayFormula: boolean | null
    hasNowFormula: boolean | null
  } | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CodaColumn {
  id: string
  name: string
  href: string
  display: boolean | null
  calculated: boolean | null
  formula: string | null
  defaultValue: string | null
  format: Record<string, unknown> | null
  parentTable: CodaTableRef | null
}

export interface CodaRow {
  id: string
  name: string
  index: number | null
  href: string
  browserLink: string
  createdAt: string | null
  updatedAt: string | null
  values: Record<string, unknown>
  parentTable: CodaTableRef | null
}

export interface CodaNamedReference {
  id: string
  name: string
  href: string
  parent: CodaPageRef | null
}

export interface CodaFormula extends CodaNamedReference {
  value: unknown
}

export interface CodaControl extends CodaNamedReference {
  controlType: string | null
  value: unknown
}

export interface CodaFolder {
  id: string
  name: string | null
  browserLink: string | null
  description: string | null
  icon: CodaIcon | null
  iconColor: string | null
  createdAt: string | null
  canEdit: boolean | null
  workspace: CodaWorkspaceRef | null
}

export interface CodaPermission {
  id: string
  access: string
  principal: {
    type: string | null
    email: string | null
    groupId: string | null
    groupName: string | null
    domain: string | null
    workspaceId: string | null
    internalAccessType: string | null
  }
}

export type CodaListResponse<K extends string, T> = ToolResponse & {
  output: Record<K, T[]> & { nextPageToken: string | null }
}

export interface CodaRequestIdResponse extends ToolResponse {
  output: { requestId: string }
}

export interface CodaWhoamiResponse extends ToolResponse {
  output: {
    name: string
    loginId: string
    pictureLink: string | null
    scoped: boolean | null
    tokenName: string | null
    workspace: CodaWorkspaceRef | null
  }
}

export interface CodaListDocsParams extends CodaAuthParams, CodaPaginationParams {
  query?: string
  isOwner?: boolean
  isPublished?: boolean
  isStarred?: boolean
  inGallery?: boolean
  sourceDoc?: string
  workspaceId?: string
  folderId?: string
}

export type CodaListDocsResponse = CodaListResponse<'docs', CodaDoc>

export interface CodaDocResponse extends ToolResponse {
  output: { doc: CodaDoc }
}

export interface CodaPageContentParams {
  pageType?: string
  contentFormat?: string
  content?: string
  embedUrl?: string
  renderMethod?: string
  sourceDocId?: string
  sourcePageId?: string
  syncMode?: string
  includeSubpages?: boolean
}

export interface CodaCreateDocParams extends CodaAuthParams, CodaPageContentParams {
  title?: string
  sourceDoc?: string
  timezone?: string
  folderId?: string
  pageName?: string
  pageSubtitle?: string
  iconName?: string
  imageUrl?: string
}

export interface CodaCreateDocResponse extends ToolResponse {
  output: { doc: CodaDoc; requestId: string | null }
}

export interface CodaUpdateDocParams extends CodaDocParams {
  title?: string
  iconName?: string
}

export interface CodaDocIdResponse extends ToolResponse {
  output: { docId: string }
}

export interface CodaListCategoriesResponse extends ToolResponse {
  output: { categories: string[] }
}

export interface CodaPublishDocParams extends CodaDocParams {
  slug?: string
  discoverable?: boolean
  categoryNames?: unknown
  mode?: string
}

export interface CodaSharingMetadataResponse extends ToolResponse {
  output: {
    canShare: boolean
    canShareWithWorkspace: boolean
    canShareWithOrg: boolean
    canCopy: boolean
  }
}

export interface CodaAclSettingsParams extends CodaDocParams {
  allowEditorsToChangePermissions?: boolean
  allowCopying?: boolean
  allowViewersToRequestEditing?: boolean
}

export interface CodaAclSettingsResponse extends ToolResponse {
  output: {
    allowEditorsToChangePermissions: boolean
    allowCopying: boolean
    allowViewersToRequestEditing: boolean
  }
}

export interface CodaSearchPrincipalsParams extends CodaDocParams {
  query?: string
}

export interface CodaSearchPrincipalsResponse extends ToolResponse {
  output: {
    users: Array<{ name: string; loginId: string; pictureLink: string | null }>
    groups: Array<{ groupId: string; groupName: string }>
  }
}

export interface CodaListPermissionsParams extends CodaDocParams, CodaPaginationParams {}

export type CodaListPermissionsResponse = CodaListResponse<'permissions', CodaPermission>

export type CodaPrincipalType = 'email' | 'group' | 'domain' | 'workspace' | 'anyone'

export interface CodaAddPermissionParams extends CodaDocParams {
  access: 'readonly' | 'write' | 'comment'
  principalType: CodaPrincipalType
  principal?: string
  suppressEmail?: boolean
}

export interface CodaAddPermissionResponse extends ToolResponse {
  output: { docId: string; access: string; principalType: string }
}

export interface CodaDeletePermissionParams extends CodaDocParams {
  permissionId: string
}

export interface CodaDeletePermissionResponse extends ToolResponse {
  output: { docId: string; permissionId: string }
}

export interface CodaListPagesParams extends CodaDocParams, CodaPaginationParams {}

export type CodaListPagesResponse = CodaListResponse<'pages', CodaPage>

export interface CodaPageResponse extends ToolResponse {
  output: { page: CodaPage }
}

export interface CodaCreatePageParams extends CodaDocParams, CodaPageContentParams {
  name?: string
  subtitle?: string
  iconName?: string
  imageUrl?: string
  parentPageId?: string
}

export interface CodaUpdatePageParams extends CodaPageParams {
  name?: string
  subtitle?: string
  iconName?: string
  imageUrl?: string
  isHidden?: boolean
  insertionMode?: string
  elementId?: string
  contentFormat?: string
  content?: string
}

export interface CodaPageMutationResponse extends ToolResponse {
  output: { requestId: string; pageId: string }
}

export interface CodaDeletePageContentParams extends CodaPageParams {
  elementIds?: unknown
  deleteAll?: boolean
}

export interface CodaGetPageContentParams extends CodaPageParams, CodaPaginationParams {}

export interface CodaPageContentItem {
  id: string
  type: string
  style: string | null
  format: string | null
  content: string | null
  lineLevel: number | null
}

export type CodaGetPageContentResponse = CodaListResponse<'items', CodaPageContentItem>

export interface CodaExportPageParams extends CodaPageParams {
  outputFormat: string
}

export interface CodaExportPageResponse extends ToolResponse {
  output: { exportId: string; status: string; href: string }
}

export interface CodaGetPageExportStatusParams extends CodaPageParams {
  exportId: string
}

export interface CodaPageExportStatusResponse extends ToolResponse {
  output: {
    exportId: string
    status: string
    href: string
    downloadLink: string | null
    exportError: string | null
  }
}

export interface CodaListTablesParams extends CodaDocParams, CodaPaginationParams {
  sortBy?: string
  tableTypes?: unknown
}

export type CodaListTablesResponse = CodaListResponse<'tables', CodaTableReference>

export interface CodaGetTableParams extends CodaTableParams {
  useUpdatedTableLayouts?: boolean
}

export interface CodaTableResponse extends ToolResponse {
  output: { table: CodaTable }
}

export interface CodaListColumnsParams extends CodaTableParams, CodaPaginationParams {
  visibleOnly?: boolean
}

export type CodaListColumnsResponse = CodaListResponse<'columns', CodaColumn>

export interface CodaGetColumnParams extends CodaTableParams {
  columnId: string
}

export interface CodaColumnResponse extends ToolResponse {
  output: { column: CodaColumn }
}

export interface CodaListRowsParams extends CodaTableParams, CodaPaginationParams {
  query?: string
  sortBy?: string
  useColumnNames?: boolean
  valueFormat?: string
  visibleOnly?: boolean
  syncToken?: string
}

export interface CodaListRowsResponse extends ToolResponse {
  output: { rows: CodaRow[]; nextPageToken: string | null; nextSyncToken: string | null }
}

export interface CodaGetRowParams extends CodaRowParams {
  useColumnNames?: boolean
  valueFormat?: string
}

export interface CodaRowResponse extends ToolResponse {
  output: { row: CodaRow }
}

export interface CodaUpsertRowsParams extends CodaTableParams {
  rows: unknown
  keyColumns?: unknown
  disableParsing?: boolean
}

export interface CodaUpsertRowsResponse extends ToolResponse {
  output: { requestId: string; addedRowIds: string[] }
}

export interface CodaUpdateRowParams extends CodaRowParams {
  cells: unknown
  disableParsing?: boolean
}

export interface CodaRowMutationResponse extends ToolResponse {
  output: { requestId: string; rowId: string }
}

export interface CodaDeleteRowsParams extends CodaTableParams {
  rowIds: unknown
}

export interface CodaDeleteRowsResponse extends ToolResponse {
  output: { requestId: string; rowIds: string[] }
}

export interface CodaPushButtonParams extends CodaRowParams {
  columnId: string
}

export interface CodaPushButtonResponse extends ToolResponse {
  output: { requestId: string; rowId: string; columnId: string }
}

export interface CodaListDocItemsParams extends CodaDocParams, CodaPaginationParams {
  sortBy?: string
}

export type CodaListFormulasResponse = CodaListResponse<'formulas', CodaNamedReference>

export interface CodaGetFormulaParams extends CodaDocParams {
  formulaId: string
}

export interface CodaFormulaResponse extends ToolResponse {
  output: { formula: CodaFormula }
}

export type CodaListControlsResponse = CodaListResponse<'controls', CodaNamedReference>

export interface CodaGetControlParams extends CodaDocParams {
  controlId: string
}

export interface CodaControlResponse extends ToolResponse {
  output: { control: CodaControl }
}

export interface CodaListFoldersParams extends CodaAuthParams, CodaPaginationParams {
  workspaceId?: string
  isStarred?: boolean
}

export type CodaListFoldersResponse = CodaListResponse<'folders', CodaFolder>

export interface CodaFolderParams extends CodaAuthParams {
  folderId: string
}

export interface CodaFolderResponse extends ToolResponse {
  output: { folder: CodaFolder }
}

export interface CodaCreateFolderParams extends CodaAuthParams {
  name: string
  workspaceId: string
  description?: string
}

export interface CodaUpdateFolderParams extends CodaFolderParams {
  name?: string
  description?: string
}

export interface CodaDeleteFolderResponse extends ToolResponse {
  output: { folderId: string }
}

export interface CodaListFolderChildrenParams extends CodaFolderParams, CodaPaginationParams {}

export type CodaFolderChild = Omit<CodaFolder, 'icon'> & { visibility: string }

export type CodaListFolderChildrenResponse = CodaListResponse<'children', CodaFolderChild>

export interface CodaWorkspaceParams extends CodaAuthParams {
  workspaceId: string
}

export interface CodaListWorkspaceMembersParams extends CodaWorkspaceParams {
  includedRoles?: unknown
  pageToken?: string
}

export interface CodaWorkspaceMember {
  email: string
  name: string
  role: string
  pictureUrl: string | null
  registeredAt: string
  roleChangedAt: string | null
  lastActiveAt: string | null
  ownedDocs: number | null
  docsLastActiveAt: string | null
  docCollaboratorCount: number | null
  totalDocs: number | null
  totalDocsLastActiveAt: string | null
  totalDocCollaboratorsLast90Days: number | null
}

export type CodaListWorkspaceMembersResponse = CodaListResponse<'members', CodaWorkspaceMember>

export interface CodaChangeUserRoleParams extends CodaWorkspaceParams {
  email: string
  newRole: string
}

export interface CodaChangeUserRoleResponse extends ToolResponse {
  output: { email: string; newRole: string; roleChangedAt: string }
}

export interface CodaWorkspaceRoleActivity {
  month: string
  activeAdminCount: number
  activeDocMakerCount: number
  activeEditorCount: number
  inactiveAdminCount: number
  inactiveDocMakerCount: number
  inactiveEditorCount: number
}

export interface CodaListWorkspaceRolesResponse extends ToolResponse {
  output: { roleActivity: CodaWorkspaceRoleActivity[] }
}

export interface CodaListDocAnalyticsParams extends CodaAuthParams, CodaPaginationParams {
  docIds?: unknown
  workspaceId?: string
  query?: string
  isPublished?: boolean
  sinceDate?: string
  untilDate?: string
  scale?: string
  orderBy?: string
  direction?: string
}

export interface CodaDocAnalyticsItem {
  doc: {
    id: string
    title: string
    href: string
    browserLink: string
    icon: CodaIcon | null
    createdAt: string | null
    publishedAt: string | null
  }
  metrics: Array<Record<string, string | number | null>>
}

export type CodaListDocAnalyticsResponse = CodaListResponse<'items', CodaDocAnalyticsItem>

export interface CodaListPageAnalyticsParams extends CodaDocParams, CodaPaginationParams {
  sinceDate?: string
  untilDate?: string
}

export interface CodaPageAnalyticsItem {
  page: { id: string; name: string; icon: CodaIcon | null }
  metrics: Array<Record<string, string | number | null>>
}

export type CodaListPageAnalyticsResponse = CodaListResponse<'items', CodaPageAnalyticsItem>

export interface CodaDocAnalyticsSummaryParams extends CodaAuthParams {
  isPublished?: boolean
  sinceDate?: string
  untilDate?: string
  workspaceId?: string
}

export interface CodaDocAnalyticsSummaryResponse extends ToolResponse {
  output: { totalSessions: number }
}

export interface CodaAnalyticsLastUpdatedResponse extends ToolResponse {
  output: {
    docAnalyticsLastUpdated: string
    packAnalyticsLastUpdated: string
    packFormulaAnalyticsLastUpdated: string
  }
}

export interface CodaCustomDomain {
  customDocDomain: string
  hasCertificate: boolean
  hasDnsDocId: boolean
  setupStatus: string
  domainStatus: string
  lastVerifiedTimestamp: string | null
}

export interface CodaListCustomDomainsResponse extends ToolResponse {
  output: { customDomains: CodaCustomDomain[]; nextPageToken: string | null }
}

export interface CodaCustomDomainParams extends CodaDocParams {
  customDocDomain: string
}

export interface CodaCustomDomainResponse extends ToolResponse {
  output: { docId: string; customDocDomain: string }
}

export interface CodaGetCustomDomainProviderParams extends CodaAuthParams {
  customDocDomain: string
}

export interface CodaGetCustomDomainProviderResponse extends ToolResponse {
  output: { customDocDomain: string; provider: string }
}

export interface CodaResolveBrowserLinkParams extends CodaAuthParams {
  url: string
  degradeGracefully?: boolean
}

export interface CodaResolveBrowserLinkResponse extends ToolResponse {
  output: {
    browserLink: string | null
    resource: { type: string; id: string; name: string | null; href: string }
  }
}

export interface CodaGetMutationStatusParams extends CodaAuthParams {
  requestId: string
}

export interface CodaGetMutationStatusResponse extends ToolResponse {
  output: { completed: boolean; warning: string | null }
}

export interface CodaTriggerAutomationParams extends CodaDocParams {
  ruleId: string
  payload?: unknown
}

export type CodaResponse =
  | CodaWhoamiResponse
  | CodaListDocsResponse
  | CodaDocResponse
  | CodaCreateDocResponse
  | CodaDocIdResponse
  | CodaListCategoriesResponse
  | CodaRequestIdResponse
  | CodaSharingMetadataResponse
  | CodaAclSettingsResponse
  | CodaSearchPrincipalsResponse
  | CodaListPermissionsResponse
  | CodaAddPermissionResponse
  | CodaDeletePermissionResponse
  | CodaListPagesResponse
  | CodaPageResponse
  | CodaPageMutationResponse
  | CodaGetPageContentResponse
  | CodaExportPageResponse
  | CodaPageExportStatusResponse
  | CodaListTablesResponse
  | CodaTableResponse
  | CodaListColumnsResponse
  | CodaColumnResponse
  | CodaListRowsResponse
  | CodaRowResponse
  | CodaUpsertRowsResponse
  | CodaRowMutationResponse
  | CodaDeleteRowsResponse
  | CodaPushButtonResponse
  | CodaListFormulasResponse
  | CodaFormulaResponse
  | CodaListControlsResponse
  | CodaControlResponse
  | CodaListFoldersResponse
  | CodaFolderResponse
  | CodaDeleteFolderResponse
  | CodaListFolderChildrenResponse
  | CodaListWorkspaceMembersResponse
  | CodaChangeUserRoleResponse
  | CodaListWorkspaceRolesResponse
  | CodaListDocAnalyticsResponse
  | CodaListPageAnalyticsResponse
  | CodaDocAnalyticsSummaryResponse
  | CodaAnalyticsLastUpdatedResponse
  | CodaListCustomDomainsResponse
  | CodaCustomDomainResponse
  | CodaGetCustomDomainProviderResponse
  | CodaResolveBrowserLinkResponse
  | CodaGetMutationStatusResponse
