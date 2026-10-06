import { z } from 'zod'

const assetIdSchema = z.string()

const fieldsSchema = z.record(z.string(), assetIdSchema)

const attributesSchema = z.object({
  entity_type: assetIdSchema.optional(),
})

const id045d22Schema = z.null()

const idSchema = z.union([assetIdSchema, id045d22Schema])

const collectionSchema = z.union([assetIdSchema, id045d22Schema])

const firstNameSchema = z.union([assetIdSchema, id045d22Schema])

const lastNameSchema = z.union([assetIdSchema, id045d22Schema])

const emailSchema = z.union([assetIdSchema, id045d22Schema])

const avatarSchema = z.union([assetIdSchema, id045d22Schema])

const avatarUrlSchema = z.union([assetIdSchema, id045d22Schema])

const displayNameSchema = z.union([assetIdSchema, id045d22Schema])

const userLiteSchema = z.object({
  id: idSchema.optional(),
  first_name: firstNameSchema.optional(),
  last_name: lastNameSchema.optional(),
  email: emailSchema.optional(),
  avatar: avatarSchema.optional(),
  avatar_url: avatarUrlSchema.optional(),
  display_name: displayNameSchema.optional(),
})

const collectionMemberAccessEnumSchema = z.number()

const createdAtSchema = z.union([assetIdSchema, id045d22Schema])

const updatedAtSchema = z.union([assetIdSchema, id045d22Schema])

const pageSchema = z.union([assetIdSchema, id045d22Schema])

const sortOrderdde3e5Schema = z.number()

const sortOrderSchema = z.union([sortOrderdde3e5Schema, id045d22Schema])

const nameSchema = z.union([assetIdSchema, id045d22Schema])

const ownedByIdSchema = z.union([assetIdSchema, id045d22Schema])

const collectionAccessEnumSchema = z.number()

const hasPages8e2bc3Schema = z.boolean()

const hasPagesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isDefaultSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isGlobalSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const logoProps44136fSchema = z.json()

const logoPropsSchema = z.union([logoProps44136fSchema, id045d22Schema])

const pageCollectionIdSchema = z.union([assetIdSchema, id045d22Schema])

const collectionIdSchema = z.union([assetIdSchema, id045d22Schema])

const parentIdSchema = z.union([assetIdSchema, id045d22Schema])

const access644595Schema = z.number()

const logopropse73098Schema = z.record(z.string(), z.json())

const parentId64f4aeSchema = z.json()

const labelIdsSchema = z.array(logoProps44136fSchema)

export const collectionPageSearchResultSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  logo_props: logoPropsSchema.optional(),
})

const deletedAtSchema = z.union([assetIdSchema, id045d22Schema])

const displayNamed4d29dSchema = z.string()

const descriptionSchema = z.union([assetIdSchema, id045d22Schema])

const customerPropertyTypeSchema = z.string()

const customerRelationTypeSchema = z.string()

const isRequiredSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const defaultValuecb839fSchema = z.array(assetIdSchema)

const defaultValueSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const displayFormatSchema = z.string()

const textAttributeSettingsSchema = z.object({
  display_format: displayFormatSchema.optional(),
})

const displayFormat46d1f6Schema = z.string()

const dateAttributeSettingsSchema = z.object({
  display_format: displayFormat46d1f6Schema.optional(),
})

const settings43c814Schema = z.record(z.string(), z.json())

const isActiveSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isMultiSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const validationRulesSchema = z.union([logoProps44136fSchema, id045d22Schema])

const externalSourceSchema = z.union([assetIdSchema, id045d22Schema])

const externalIdSchema = z.union([assetIdSchema, id045d22Schema])

const nameeb0f45Schema = z.string()

const propertySchema = z.union([assetIdSchema, id045d22Schema])

const description2c8fe8Schema = z.union([logoProps44136fSchema, id045d22Schema])

const descriptionHtmlSchema = z.union([assetIdSchema, id045d22Schema])

const linkSchema = z.union([assetIdSchema, id045d22Schema])

const workItemIdsSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const attachmentCountSchema = z.union([access644595Schema, id045d22Schema])

const customerRequestCountSchema = z.union([access644595Schema, id045d22Schema])

const logoUrlSchema = z.union([assetIdSchema, id045d22Schema])

const descriptionStrippedSchema = z.union([assetIdSchema, id045d22Schema])

const descriptionBinarySchema = z.union([assetIdSchema, id045d22Schema])

const websiteUrlSchema = z.union([assetIdSchema, id045d22Schema])

const domainSchema = z.union([assetIdSchema, id045d22Schema])

const employeesSchema = z.union([access644595Schema, id045d22Schema])

const stageSchema = z.union([assetIdSchema, id045d22Schema])

const contractStatusSchema = z.union([assetIdSchema, id045d22Schema])

const revenueSchema = z.union([assetIdSchema, id045d22Schema])

const archivedAtSchema = z.union([assetIdSchema, id045d22Schema])

const logoAssetSchema = z.union([assetIdSchema, id045d22Schema])

const ide04262Schema = z.string()

const sequenceIdSchema = z.union([access644595Schema, id045d22Schema])

const projectIdSchema = z.union([assetIdSchema, id045d22Schema])

const detailSchema = z.string()

const planeListCustomerPropertyValuesResultSchema = z.object({
  detail: assetIdSchema.optional(),
})

export const customerRequestbeca62Schema = z.object({
  id: idSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: description2c8fe8Schema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  link: linkSchema.optional(),
  work_item_ids: workItemIdsSchema.optional(),
  attachment_count: attachmentCountSchema.optional(),
  created_at: createdAtSchema.optional(),
})

const subIssuesCountSchema = z.union([access644595Schema, id045d22Schema])

const identifierSchema = z.string()

const coverImageSchema = z.union([assetIdSchema, id045d22Schema])

const iconPropSchema = z.union([logoProps44136fSchema, id045d22Schema])

const emojiSchema = z.union([assetIdSchema, id045d22Schema])

const coverImageUrlSchema = z.union([assetIdSchema, id045d22Schema])

const issueSchema = z.union([assetIdSchema, id045d22Schema])

const cycleSchema = z.union([assetIdSchema, id045d22Schema])

const totalIssuesSchema = z.union([access644595Schema, id045d22Schema])

const cancelledIssuesSchema = z.union([access644595Schema, id045d22Schema])

const completedIssuesSchema = z.union([access644595Schema, id045d22Schema])

const startedIssuesSchema = z.union([access644595Schema, id045d22Schema])

const unstartedIssuesSchema = z.union([access644595Schema, id045d22Schema])

const backlogIssuesSchema = z.union([access644595Schema, id045d22Schema])

const totalEstimatesSchema = z.union([access644595Schema, id045d22Schema])

const completedEstimatesSchema = z.union([access644595Schema, id045d22Schema])

const startedEstimatesSchema = z.union([access644595Schema, id045d22Schema])

const startDateSchema = z.union([assetIdSchema, id045d22Schema])

const endDateSchema = z.union([assetIdSchema, id045d22Schema])

const viewPropsSchema = z.union([logoProps44136fSchema, id045d22Schema])

const progressSnapshotSchema = z.union([logoProps44136fSchema, id045d22Schema])

const timezoneSchema = z.union([assetIdSchema, id045d22Schema])

const versionSchema = z.union([access644595Schema, id045d22Schema])

const colorSchema = z.union([assetIdSchema, id045d22Schema])

const typeIdSchema = z.union([assetIdSchema, id045d22Schema])

const pointSchema = z.union([access644595Schema, id045d22Schema])

const priorityb96bbbSchema = z.string()

const priority7c079dSchema = z.union([priorityb96bbbSchema, id045d22Schema])

const targetDateSchema = z.union([assetIdSchema, id045d22Schema])

const completedAtSchema = z.union([assetIdSchema, id045d22Schema])

const isDraftSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const groupb0d31eSchema = z.string()

const groupSchema = z.union([groupb0d31eSchema, id045d22Schema])

const stateLiteSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
  group: groupSchema.optional(),
})

const estimateSchema = z.union([assetIdSchema, id045d22Schema])

const keySchema = z.union([access644595Schema, id045d22Schema])

const valueSchema = z.string()

const createdBy94a812Schema = z.union([assetIdSchema, id045d22Schema])

const updatedBy1f6d11Schema = z.union([assetIdSchema, id045d22Schema])

const project0bf380Schema = z.union([assetIdSchema, id045d22Schema])

const workspace8d2899Schema = z.union([assetIdSchema, id045d22Schema])

const typeSchema = z.union([assetIdSchema, settings43c814Schema, id045d22Schema])

const cycle883343Schema = z.union([assetIdSchema, id045d22Schema])

const type0858aeSchema = z.union([assetIdSchema, id045d22Schema])

const project4c8ec3Schema = z.string()

const workspace259123Schema = z.string()

const lastUsedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

export const planeListWorkspaceMappingsResultItemSchema = z.object({
  id: assetIdSchema.optional(),
  idp_group_name: assetIdSchema.optional(),
  role: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

const descriptionBinary930eb0Schema = z.string()

const descriptionBinary7500edSchema = z.union([descriptionBinary930eb0Schema, id045d22Schema])

const logoPropsf7fcccSchema = z.record(z.string(), z.json())

const initiativeStateSchema = z.string()

const leadSchema = z.union([assetIdSchema, id045d22Schema])

const totalMembersSchema = z.union([access644595Schema, id045d22Schema])

const totalCyclesSchema = z.union([access644595Schema, id045d22Schema])

const totalModulesSchema = z.union([access644595Schema, id045d22Schema])

const isMemberSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const memberRoleSchema = z.union([access644595Schema, id045d22Schema])

const isDeployedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const descriptionTextSchema = z.union([logoProps44136fSchema, id045d22Schema])

const descriptionHtmlfa4901Schema = z.union([logoProps44136fSchema, id045d22Schema])

const networkSchema = z.union([access644595Schema, id045d22Schema])

const moduleViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const cycleViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const issueViewsViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const pageViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const intakeViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isTimeTrackingEnabledSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isIssueTypeEnabledSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const guestViewAllFeaturesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const archiveInSchema = z.union([access644595Schema, id045d22Schema])

const closeInSchema = z.union([access644595Schema, id045d22Schema])

const timezone467abfSchema = z.string()

const timezone7677ddSchema = z.union([timezone467abfSchema, id045d22Schema])

const coverImageAssetSchema = z.union([assetIdSchema, id045d22Schema])

const defaultStateSchema = z.union([assetIdSchema, id045d22Schema])

const extraStatsSchema = z.json()

const resultsItemSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  description: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
})

const resultsSchema = z.array(resultsItemSchema)

const cyclec886e3Schema = z.union([logoProps44136fSchema, id045d22Schema])

const statusd21fa3Schema = z.string()

const statusSchema = z.union([statusd21fa3Schema, id045d22Schema])

const membersSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const inboxSchema = z.union([assetIdSchema, id045d22Schema])

const status60a688Schema = z.union([access644595Schema, id045d22Schema])

const snoozedTillSchema = z.union([assetIdSchema, id045d22Schema])

const sourceSchema = z.union([assetIdSchema, id045d22Schema])

const sourceEmailSchema = z.union([assetIdSchema, id045d22Schema])

const extraSchema = z.union([logoProps44136fSchema, id045d22Schema])

const intakeSchema = z.union([assetIdSchema, id045d22Schema])

const issue6ae224Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  description: assetIdSchema.optional(),
  priority: assetIdSchema.optional(),
  sequence_id: sortOrderdde3e5Schema.optional(),
})

const issue4193e9Schema = z.union([issueSchema, issue6ae224Schema])

const duplicateToSchema = z.union([assetIdSchema, id045d22Schema])

const verbSchema = z.union([assetIdSchema, id045d22Schema])

const fieldSchema = z.union([assetIdSchema, id045d22Schema])

const oldValueSchema = z.union([assetIdSchema, id045d22Schema])

const newValueSchema = z.union([assetIdSchema, id045d22Schema])

const commentSchema = z.union([assetIdSchema, id045d22Schema])

const attachmentsSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const oldIdentifierSchema = z.union([assetIdSchema, id045d22Schema])

const newIdentifierSchema = z.union([assetIdSchema, id045d22Schema])

const epochSchema = z.union([access644595Schema, id045d22Schema])

const issueCommentSchema = z.union([assetIdSchema, id045d22Schema])

const resultsItemb8d56eSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
})

const results803362Schema = z.array(resultsItemb8d56eSchema)

const attributes0d5d79Schema = z.union([logoProps44136fSchema, id045d22Schema])

const assetSchema = z.string()

const entityTypeSchema = z.union([assetIdSchema, id045d22Schema])

const entityIdentifierSchema = z.union([assetIdSchema, id045d22Schema])

const isDeletedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isArchivedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const sizeSchema = z.union([access644595Schema, id045d22Schema])

const isUploadedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const storageMetadataSchema = z.union([logoProps44136fSchema, id045d22Schema])

const draftIssueSchema = z.union([assetIdSchema, id045d22Schema])

const uploadData016c9cSchema = z.object({
  url: assetIdSchema.optional(),
  fields: fieldsSchema.optional(),
})

const commentStrippedSchema = z.union([assetIdSchema, id045d22Schema])

const commentHtmlSchema = z.union([assetIdSchema, id045d22Schema])

const access4ffefdSchema = z.string()

const access11dbb2Schema = z.union([access4ffefdSchema, id045d22Schema])

const editedAtSchema = z.union([assetIdSchema, id045d22Schema])

const contentItemb5dbeeSchema = z.object({
  type: assetIdSchema.optional(),
  text: assetIdSchema.optional(),
})

const content3ab776Schema = z.array(contentItemb5dbeeSchema)

const contentItemSchema = z.object({
  type: assetIdSchema.optional(),
  content: content3ab776Schema.optional(),
})

const contentSchema = z.array(contentItemSchema)

const commentjsonSchema = z.object({
  type: assetIdSchema.optional(),
  content: contentSchema.optional(),
})

const projectIdsSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const isEpicSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const levelSchema = z.union([access644595Schema, id045d22Schema])

const id0c8996Schema = z.string()

const propertyIdSchema = z.string()

const issueIdSchema = z.string()

const value1511a4Schema = z.union([
  assetIdSchema,
  hasPages8e2bc3Schema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

const valueTypeSchema = z.union([assetIdSchema, id045d22Schema])

const idafabc3Schema = z.union([assetIdSchema, id045d22Schema])

const descriptionHtml09c8d5Schema = z.string()

const descriptionStrippedeb4857Schema = z.string()

const richTextValueDetailSchema = z.object({
  id: idafabc3Schema.optional(),
  description_html: descriptionHtml09c8d5Schema.optional(),
  description_stripped: descriptionStrippedeb4857Schema.optional(),
})

const valueDetailSchema = z.union([richTextValueDetailSchema, id045d22Schema])

const externalIdc082ccSchema = z.union([assetIdSchema, id045d22Schema])

const externalSource22e8d8Schema = z.union([assetIdSchema, id045d22Schema])

const createdAt6ca285Schema = z.union([assetIdSchema, id045d22Schema])

const updatedAt32ad46Schema = z.union([assetIdSchema, id045d22Schema])

export const workItemPropertyValueDetailSchema = z.object({
  id: id0c8996Schema.optional(),
  property_id: propertyIdSchema.optional(),
  issue_id: issueIdSchema.optional(),
  value: value1511a4Schema.optional(),
  value_type: valueTypeSchema.optional(),
  value_detail: valueDetailSchema.optional(),
  external_id: externalIdc082ccSchema.optional(),
  external_source: externalSource22e8d8Schema.optional(),
  created_at: createdAt6ca285Schema.optional(),
  updated_at: updatedAt32ad46Schema.optional(),
})

const titleSchema = z.union([assetIdSchema, id045d22Schema])

const urlSchema = z.string()

const metadataSchema = z.union([logoProps44136fSchema, id045d22Schema])

const roleSchema = z.union([access644595Schema, id045d22Schema])

const roleSlugSchema = z.union([assetIdSchema, id045d22Schema])

const isBotSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

export const projectMemberSchema = z.object({
  id: idSchema.optional(),
  first_name: firstNameSchema.optional(),
  last_name: lastNameSchema.optional(),
  email: emailSchema.optional(),
  avatar: avatarSchema.optional(),
  avatar_url: avatarUrlSchema.optional(),
  display_name: displayNameSchema.optional(),
  role: roleSchema.optional(),
  role_slug: roleSlugSchema.optional(),
  is_active: isActiveSchema.optional(),
  is_bot: isBotSchema.optional(),
})

export const workspaceMemberSchema = z.object({
  id: idSchema.optional(),
  first_name: firstNameSchema.optional(),
  last_name: lastNameSchema.optional(),
  email: emailSchema.optional(),
  avatar: avatarSchema.optional(),
  avatar_url: avatarUrlSchema.optional(),
  display_name: displayNameSchema.optional(),
  role: roleSchema.optional(),
  role_slug: roleSlugSchema.optional(),
  is_active: isActiveSchema.optional(),
  is_bot: isBotSchema.optional(),
})

const title835a49Schema = z.string()

export const milestoneSchema = z.object({
  id: idSchema.optional(),
  title: title835a49Schema.optional(),
  target_date: targetDateSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
})

const milestone92b31cSchema = z.union([assetIdSchema, id045d22Schema])

export const milestoneWorkItemSchema = z.object({
  id: idSchema.optional(),
  issue: issueSchema.optional(),
  milestone: milestone92b31cSchema.optional(),
})

const module83515fSchema = z.union([assetIdSchema, id045d22Schema])

const descriptionb39dcdSchema = z.union([settings43c814Schema, assetIdSchema, id045d22Schema])

const anchorSchema = z.union([assetIdSchema, id045d22Schema])

const projectsSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const isLockedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const linksSchema = z.object({
  download: assetIdSchema.optional(),
})

export const planeGetWorkspacePageAttachmentResultSchema = z.object({
  id: assetIdSchema.optional(),
  page_id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  type: assetIdSchema.optional(),
  size: access644595Schema.optional(),
  is_uploaded: hasPages8e2bc3Schema.optional(),
  asset_url: assetIdSchema.optional(),
  _links: linksSchema.optional(),
})

const epicsSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const modulesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const cyclesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const viewsSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const pagesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const intakesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const workItemTypesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const workflowsSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const parallelCyclesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const projectUpdatesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const project24481aSchema = z.json()

const status4b8517Schema = z.union([assetIdSchema, id045d22Schema])

const releaseDateSchema = z.union([assetIdSchema, id045d22Schema])

const tagSchema = z.union([assetIdSchema, id045d22Schema])

const isLatestSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isPrereleaseSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const commentfbe0c5Schema = z.union([logoProps44136fSchema, id045d22Schema])

const isHiddenSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isResolvedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const release5c8689Schema = z.union([assetIdSchema, id045d22Schema])

const urlb58d03Schema = z.union([assetIdSchema, id045d22Schema])

const versione55854Schema = z.union([assetIdSchema, id045d22Schema])

const commitHashSchema = z.union([assetIdSchema, id045d22Schema])

const gitTagSchema = z.union([assetIdSchema, id045d22Schema])

const changelogSchema = z.union([logoProps44136fSchema, id045d22Schema])

const colorbba70bSchema = z.string()

const sequenceSchema = z.union([sortOrderdde3e5Schema, id045d22Schema])

const isTriageSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const defaultSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const logoProps235527Schema = z.union([settings43c814Schema, id045d22Schema])

const backgroundColorSchema = z.union([assetIdSchema, id045d22Schema])

const ownerSchema = z.string()

const resultsItemff2ea6Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  description_html: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
})

const results5fa64dSchema = z.array(resultsItemff2ea6Schema)

const descriptionJsonf6e894Schema = z.record(z.string(), z.json())

const descriptionJsonSchema = z.union([descriptionJsonf6e894Schema, assetIdSchema, id045d22Schema])

const emoji4e6283Schema = z.object({
  value: assetIdSchema.optional(),
})

const logoProps8ef9c5Schema = z.object({
  in_use: assetIdSchema.optional(),
  emoji: emoji4e6283Schema.optional(),
})

const logoProps30a00bSchema = z.union([logoProps8ef9c5Schema, id045d22Schema])

const createdAtff28e1Schema = z.string()

const updatedAt43e222Schema = z.string()

const updatedBye10d2eSchema = z.json()

const blockingItemc976a8Schema = z.object({
  project_id: assetIdSchema.optional(),
  issue_id: assetIdSchema.optional(),
})

const blockingItemSchema = z.union([assetIdSchema, blockingItemc976a8Schema])

const blockingSchema = z.array(blockingItemSchema)

export const workItemRelationsSchema = z.object({
  blocking: blockingSchema.optional(),
  blocked_by: blockingSchema.optional(),
  duplicate: blockingSchema.optional(),
  relates_to: blockingSchema.optional(),
  start_after: blockingSchema.optional(),
  start_before: blockingSchema.optional(),
  finish_after: blockingSchema.optional(),
  finish_before: blockingSchema.optional(),
})

const durationSchema = z.union([access644595Schema, id045d22Schema])

const workspaceId41dad2Schema = z.union([assetIdSchema, id045d22Schema])

const loggedBySchema = z.union([assetIdSchema, id045d22Schema])

const projectGroupingSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const initiativesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const teamsSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const customersSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const wikiSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const piSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const releasesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const statesOwnedByWorkspaceSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

export const planeListWorkspaceInvitationsResultItemSchema = z.object({
  id: assetIdSchema.optional(),
  email: assetIdSchema.optional(),
  role: access644595Schema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
  responded_at: assetIdSchema.optional(),
  accepted: hasPages8e2bc3Schema.optional(),
})

export const planeUpdateWorkspaceInvitationResultSchema = z.object({
  id: assetIdSchema.optional(),
  email: assetIdSchema.optional(),
  role: access644595Schema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
  responded_at: assetIdSchema.optional(),
  accepted: hasPages8e2bc3Schema.optional(),
})

const countsSchema = z.object({
  members: sortOrderdde3e5Schema.optional(),
  states: sortOrderdde3e5Schema.optional(),
  labels: sortOrderdde3e5Schema.optional(),
  cycles: sortOrderdde3e5Schema.optional(),
  modules: sortOrderdde3e5Schema.optional(),
  issues: sortOrderdde3e5Schema.optional(),
  intakes: sortOrderdde3e5Schema.optional(),
  pages: sortOrderdde3e5Schema.optional(),
})

const ide023aaSchema = z.string()

const name0ab876Schema = z.string()

const description79d89eSchema = z.string()

const currentVersionSchema = z.number()

const dataModeSchema = z.string()

const htmlSchema = z.string()

const isPublishedSchema = z.boolean()

export const planeV2ArtifactsSchema = z.object({
  id: ide023aaSchema.optional(),
  name: name0ab876Schema.optional(),
  description: description79d89eSchema.optional(),
  current_version: currentVersionSchema.optional(),
  data_mode: dataModeSchema.optional(),
  html: htmlSchema.optional(),
  is_published: isPublishedSchema.optional(),
  anchor: cycle883343Schema.optional(),
})

const anchor536038Schema = z.union([assetIdSchema, id045d22Schema])

export const planeV2Artifacts646eaeSchema = z.object({
  id: ide023aaSchema.optional(),
  name: name0ab876Schema.optional(),
  description: description79d89eSchema.optional(),
  current_version: currentVersionSchema.optional(),
  data_mode: dataModeSchema.optional(),
  html: htmlSchema.optional(),
  is_published: isPublishedSchema.optional(),
  anchor: anchor536038Schema.optional(),
})

const id6e9f97Schema = z.string()

const eventIdSchema = z.string()

const sequenceNumberSchema = z.number()

const eventNameSchema = z.string()

const categorySchema = z.string()

const outcomeSchema = z.string()

const source19411eSchema = z.string()

const actorTypeSchema = z.string()

const targetTypeSchema = z.string()

const targetIdSchema = z.string()

const targetDisplayNameSchema = z.string()

const planeV2OldValueSchema = z.object({
  role: assetIdSchema.optional(),
})

const oldValuec4f659Schema = z.union([planeV2OldValueSchema, id045d22Schema])

const planeV2NewValueSchema = z.object({
  role: assetIdSchema.optional(),
})

const newValuedcb173Schema = z.union([planeV2NewValueSchema, id045d22Schema])

const reasonSchema = z.string()

const metadata55c5f1Schema = z.json()

const planeV2MetadataSchema = z.object({
  workspace_slug: assetIdSchema.optional(),
})

const metadata4d876eSchema = z.union([metadata55c5f1Schema, planeV2MetadataSchema])

const userAgentSchema = z.string()

const workspaceIdd93d64Schema = z.string()

const projectId0a54f2Schema = z.string()

const projectId926533Schema = z.union([projectId0a54f2Schema, assetIdSchema, id045d22Schema])

const createdAtb0f827Schema = z.string()

export const planeV2AuditLogsSchema = z.object({
  id: id6e9f97Schema.optional(),
  event_id: eventIdSchema.optional(),
  sequence_number: sequenceNumberSchema.optional(),
  event_name: eventNameSchema.optional(),
  category: categorySchema.optional(),
  outcome: outcomeSchema.optional(),
  source: source19411eSchema.optional(),
  actor_type: actorTypeSchema.optional(),
  actor_id: cycle883343Schema.optional(),
  actor_display_name: assetIdSchema.optional(),
  actor_email: assetIdSchema.optional(),
  target_type: targetTypeSchema.optional(),
  target_id: targetIdSchema.optional(),
  target_display_name: targetDisplayNameSchema.optional(),
  old_value: oldValuec4f659Schema.optional(),
  new_value: newValuedcb173Schema.optional(),
  reason: reasonSchema.optional(),
  metadata: metadata4d876eSchema.optional(),
  ip_address: cycle883343Schema.optional(),
  user_agent: userAgentSchema.optional(),
  workspace_id: workspaceIdd93d64Schema.optional(),
  project_id: projectId926533Schema.optional(),
  created_at: createdAtb0f827Schema.optional(),
})

const planeV2Metadata714ad8Schema = z.object({
  workspace_slug: assetIdSchema.optional(),
  requested: assetIdSchema.optional(),
})

const metadata5edf06Schema = z.union([metadata55c5f1Schema, planeV2Metadata714ad8Schema])

const planeV2AuditLogs9faa21Schema = z.object({
  id: id6e9f97Schema.optional(),
  event_id: eventIdSchema.optional(),
  sequence_number: sequenceNumberSchema.optional(),
  event_name: eventNameSchema.optional(),
  category: categorySchema.optional(),
  outcome: outcomeSchema.optional(),
  source: source19411eSchema.optional(),
  actor_type: actorTypeSchema.optional(),
  actor_id: cycle883343Schema.optional(),
  actor_display_name: assetIdSchema.optional(),
  actor_email: assetIdSchema.optional(),
  target_type: targetTypeSchema.optional(),
  target_id: targetIdSchema.optional(),
  target_display_name: targetDisplayNameSchema.optional(),
  old_value: oldValuec4f659Schema.optional(),
  new_value: newValuedcb173Schema.optional(),
  reason: reasonSchema.optional(),
  metadata: metadata5edf06Schema.optional(),
  ip_address: cycle883343Schema.optional(),
  user_agent: userAgentSchema.optional(),
  workspace_id: workspaceIdd93d64Schema.optional(),
  project_id: projectId926533Schema.optional(),
  created_at: createdAtb0f827Schema.optional(),
})

const dataSchema = z.array(planeV2AuditLogs9faa21Schema)

const previousSchema = z.union([access644595Schema, id045d22Schema])

const planeV2PaginationSchema = z.object({
  style: assetIdSchema.optional(),
})

const access97d6dbSchema = z.number()

const createdAt50e5d2Schema = z.string()

const createdByIdSchema = z.string()

const id35193dSchema = z.string()

const isDefault779508Schema = z.boolean()

const isGlobal48e7dfSchema = z.boolean()

const logoPropsb599b9Schema = z.string()

const logoProps06abc6Schema = z.union([logoPropsb599b9Schema, id045d22Schema])

const namef3ca52Schema = z.string()

const ownedById53bb5aSchema = z.string()

const pageIdsItemSchema = z.union([assetIdSchema, defaultValuecb839fSchema])

const pageIdsSchema = z.array(pageIdsItemSchema)

const sortOrder7c3a9eSchema = z.number()

const sortOrderddaa43Schema = z.union([sortOrder7c3a9eSchema, access644595Schema])

const pageIdsd23a08Schema = z.array(assetIdSchema)

export const planeV2Collections992736Schema = z.object({
  access: access97d6dbSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  is_default: isDefault779508Schema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  page_ids: pageIdsd23a08Schema.optional(),
  sort_order: sortOrder7c3a9eSchema.optional(),
})

const defaultValue90f256Schema = z.array(assetIdSchema)

const description36d05fSchema = z.string()

const displayName940d5dSchema = z.string()

const externalIdba2ed6Schema = z.string()

const externalIde53bcdSchema = z.union([externalIdba2ed6Schema, assetIdSchema, id045d22Schema])

const externalSourcedf9b11Schema = z.string()

const externalSourceeb04b9Schema = z.union([
  externalSourcedf9b11Schema,
  assetIdSchema,
  id045d22Schema,
])

const isActive8f30a3Schema = z.boolean()

const isMulti4435adSchema = z.boolean()

const isRequiredc272a8Schema = z.boolean()

const optionsb8a8e7Schema = z.array(cycle883343Schema)

const propertyType80786bSchema = z.string()

const relationTypec98a3cSchema = z.string()

const relationTypec50139Schema = z.union([relationTypec98a3cSchema, id045d22Schema])

const settings2b72dcSchema = z.string()

const settingsff1efdSchema = z.union([settings2b72dcSchema, id045d22Schema])

const validationRules2bb568Schema = z.string()

const validationRulescd143eSchema = z.union([validationRules2bb568Schema, id045d22Schema])

const planeV2CustomerPropertiesSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  default_value: defaultValue90f256Schema.optional(),
  description: description36d05fSchema.optional(),
  display_name: displayName940d5dSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_active: isActive8f30a3Schema.optional(),
  is_multi: isMulti4435adSchema.optional(),
  is_required: isRequiredc272a8Schema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  options: optionsb8a8e7Schema.optional(),
  property_type: propertyType80786bSchema.optional(),
  relation_type: relationTypec50139Schema.optional(),
  settings: settingsff1efdSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  validation_rules: validationRulescd143eSchema.optional(),
})

const data029d9cSchema = z.array(planeV2CustomerPropertiesSchema)

const archivedAt31ccceSchema = z.union([assetIdSchema, id045d22Schema])

const customerIdSchema = z.string()

const descriptionHtml92a7e9Schema = z.string()

const link2173c1Schema = z.string()

const planeV2CustomerRequestsSchema = z.object({
  archived_at: archivedAt31ccceSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  customer_id: customerIdSchema.optional(),
  description: description36d05fSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  id: id35193dSchema.optional(),
  link: link2173c1Schema.optional(),
  name: namef3ca52Schema.optional(),
})

const data22acecSchema = z.array(planeV2CustomerRequestsSchema)

const contractStatus47b242Schema = z.string()

const customerRequestCount53613dSchema = z.number()

const domain08310aSchema = z.string()

const email0e37edSchema = z.string()

const employeesbde09aSchema = z.number()

const logoAssetIdSchema = z.string()

const logoUrle1f9ccSchema = z.string()

const revenuedc4a8cSchema = z.string()

const stagef8ed88Schema = z.string()

const websiteUrldbbbffSchema = z.string()

export const planeV2CustomersSchema = z.object({
  archived_at: archivedAt31ccceSchema.optional(),
  contract_status: contractStatus47b242Schema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  customer_request_count: customerRequestCount53613dSchema.optional(),
  description: description36d05fSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  domain: domain08310aSchema.optional(),
  email: email0e37edSchema.optional(),
  employees: employeesbde09aSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  logo_asset_id: logoAssetIdSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  logo_url: logoUrle1f9ccSchema.optional(),
  name: namef3ca52Schema.optional(),
  revenue: revenuedc4a8cSchema.optional(),
  stage: stagef8ed88Schema.optional(),
  website_url: websiteUrldbbbffSchema.optional(),
})

const dataddaf7aSchema = z.array(planeV2CustomersSchema)

const planeV2ErrorsitemSchema = z.object({
  field: assetIdSchema.optional(),
  code: assetIdSchema.optional(),
  message: assetIdSchema.optional(),
})

const errorsSchema = z.array(planeV2ErrorsitemSchema)

const planeV2ResultsitemSchema = z.object({
  index: access644595Schema.optional(),
  result: assetIdSchema.optional(),
  id: assetIdSchema.optional(),
  type: assetIdSchema.optional(),
  code: assetIdSchema.optional(),
  detail: assetIdSchema.optional(),
  errors: errorsSchema.optional(),
})

const resultsd78556Schema = z.array(planeV2ResultsitemSchema)

const planeV2Resultsitem11ddf6Schema = z.object({
  index: access644595Schema.optional(),
  result: assetIdSchema.optional(),
  id: assetIdSchema.optional(),
  type: assetIdSchema.optional(),
  code: assetIdSchema.optional(),
  detail: assetIdSchema.optional(),
})

const results0a57a3Schema = z.array(planeV2Resultsitem11ddf6Schema)

const idc6ba9cSchema = z.string()

const name55c8feSchema = z.string()

const description1faa98Schema = z.string()

const timezonec2812eSchema = z.string()

const ownedById907ebbSchema = z.string()

const sortOrder74b257Schema = z.number()

const sortOrder50ad65Schema = z.union([sortOrder74b257Schema, access644595Schema])

const logoProps47c9deSchema = z.json()

const logoPropsb439a5Schema = z.record(z.string(), z.json())

const createdAt8a8d4fSchema = z.string()

const createdByIdde9d3fSchema = z.string()

const logoPropsa76dcbSchema = z.union([logoProps47c9deSchema, id045d22Schema])

const estimateIdSchema = z.string()

const keyaae3a0Schema = z.number()

const valuef92da1Schema = z.string()

export const planeV2EstimatePointsSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  estimate_id: estimateIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  key: keyaae3a0Schema.optional(),
  value: valuef92da1Schema.optional(),
})

const data735e56Schema = z.array(planeV2EstimatePointsSchema)

const lastUsed35601dSchema = z.boolean()

const typed8bd3aSchema = z.string()

const autoRemoveSchema = z.boolean()

const defaultWorkspaceRoleSlugSchema = z.string()

const groupAttributeKeySchema = z.string()

const isEnabledSchema = z.boolean()

const syncOfflineSchema = z.boolean()

const syncOnLoginSchema = z.boolean()

const planeV2GroupSyncSchema = z.object({
  auto_remove: autoRemoveSchema.optional(),
  default_workspace_role_slug: defaultWorkspaceRoleSlugSchema.optional(),
  group_attribute_key: groupAttributeKeySchema.optional(),
  id: id35193dSchema.optional(),
  is_enabled: isEnabledSchema.optional(),
  sync_offline: syncOfflineSchema.optional(),
  sync_on_login: syncOnLoginSchema.optional(),
  all_projects: hasPages8e2bc3Schema.optional(),
  created_at: assetIdSchema.optional(),
  idp_group_name: assetIdSchema.optional(),
  project_id: assetIdSchema.optional(),
  role_slug: assetIdSchema.optional(),
})

const planeV2GroupSync26ba18Schema = z.object({
  auto_remove: autoRemoveSchema.optional(),
  default_workspace_role_slug: defaultWorkspaceRoleSlugSchema.optional(),
  group_attribute_key: groupAttributeKeySchema.optional(),
  id: id35193dSchema.optional(),
  is_enabled: isEnabledSchema.optional(),
  sync_offline: syncOfflineSchema.optional(),
  sync_on_login: syncOnLoginSchema.optional(),
  created_at: assetIdSchema.optional(),
  idp_group_name: assetIdSchema.optional(),
  role_slug: assetIdSchema.optional(),
})

const data73f281Schema = z.array(planeV2GroupSyncSchema)

const data3412d8Schema = z.array(planeV2GroupSync26ba18Schema)

const color3938eeSchema = z.string()

const planeV2InitiativeLabelsSchema = z.object({
  color: color3938eeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  id: id35193dSchema.optional(),
  name: namef3ca52Schema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
})

const data75cbc7Schema = z.array(planeV2InitiativeLabelsSchema)

const endDate9dd74eSchema = z.string()

const labelIds7d9fa4Schema = z.array(pageIdsItemSchema)

const leadIdSchema = z.string()

const projectIdsa92388Schema = z.array(pageIdsItemSchema)

const startDate43e866Schema = z.string()

const state43f46dSchema = z.string()

const duplicateToIdSchema = z.string()

const intakeIdSchema = z.string()

const priority0d388cSchema = z.string()

const snoozedTill5f1342Schema = z.string()

const source6c208dSchema = z.string()

const sourceEmaila6f632Schema = z.string()

const stateIdddfc84Schema = z.string()

const status065e3cSchema = z.number()

const workItemIdSchema = z.string()

const planeV2IntakeWorkItemsSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  duplicate_to_id: duplicateToIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  intake_id: intakeIdSchema.optional(),
  name: namef3ca52Schema.optional(),
  priority: priority0d388cSchema.optional(),
  snoozed_till: snoozedTill5f1342Schema.optional(),
  source: source6c208dSchema.optional(),
  source_email: sourceEmaila6f632Schema.optional(),
  state_id: stateIdddfc84Schema.optional(),
  status: status065e3cSchema.optional(),
  work_item_id: workItemIdSchema.optional(),
})

const data4edeaeSchema = z.array(planeV2IntakeWorkItemsSchema)

const acceptedSchema = z.boolean()

const message498389Schema = z.string()

const respondedAtSchema = z.string()

const role28996dSchema = z.string()

const planeV2InvitationsSchema = z.object({
  accepted: acceptedSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  email: email0e37edSchema.optional(),
  id: id35193dSchema.optional(),
  message: message498389Schema.optional(),
  responded_at: respondedAtSchema.optional(),
  role: role28996dSchema.optional(),
})

const dataeb406fSchema = z.array(planeV2InvitationsSchema)

const id018dceSchema = z.string()

const description96165cSchema = z.string()

const color880284Schema = z.string()

const sortOrder56bb0aSchema = z.number()

const sortOrder8e4889Schema = z.union([sortOrder56bb0aSchema, access644595Schema])

const createdAta2b7a6Schema = z.string()

export const planeV2LabelsSchema = z.object({
  id: id018dceSchema.optional(),
  name: name55c8feSchema.optional(),
  description: description96165cSchema.optional(),
  color: color880284Schema.optional(),
  sort_order: sortOrder8e4889Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAta2b7a6Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
})

const parentIdcfc087Schema = z.union([assetIdSchema, id045d22Schema])

const planeV2Labelsda6487Schema = z.object({
  id: id018dceSchema.optional(),
  name: name55c8feSchema.optional(),
  description: description96165cSchema.optional(),
  color: color880284Schema.optional(),
  sort_order: sortOrder8e4889Schema.optional(),
  parent_id: parentIdcfc087Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAta2b7a6Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
})

const data42995aSchema = z.array(planeV2Labelsda6487Schema)

const idddd330Schema = z.string()

const memberIdSchema = z.string()

const planeV2MemberSchema = z.object({
  id: assetIdSchema.optional(),
  display_name: assetIdSchema.optional(),
  avatar_url: assetIdSchema.optional(),
  email: assetIdSchema.optional(),
})

const planeV2RolesitemSchema = z.object({
  distinct_member_count: access644595Schema.optional(),
  is_system: hasPages8e2bc3Schema.optional(),
  level: access644595Schema.optional(),
  membership_count: access644595Schema.optional(),
  name: assetIdSchema.optional(),
  role_id: assetIdSchema.optional(),
  slug: assetIdSchema.optional(),
})

const rolesSchema = z.array(planeV2RolesitemSchema)

const planeV2Member706656Schema = z.object({
  id: assetIdSchema.optional(),
  display_name: assetIdSchema.optional(),
  avatar_url: cycle883343Schema.optional(),
  email: assetIdSchema.optional(),
})

const planeV2Members9c1895Schema = z.object({
  id: idddd330Schema.optional(),
  member_id: memberIdSchema.optional(),
  role: cycle883343Schema.optional(),
  member: planeV2Member706656Schema.optional(),
})

const data6057dfSchema = z.array(planeV2Members9c1895Schema)

const targetDate7b0ab1Schema = z.string()

const titlef754b4Schema = z.string()

export const planeV2MilestonesSchema = z.object({
  archived_at: archivedAt31ccceSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  target_date: targetDate7b0ab1Schema.optional(),
  title: titlef754b4Schema.optional(),
})

const data7cf2d8Schema = z.array(planeV2MilestonesSchema)

const ida3c0e8Schema = z.string()

const descriptionc3d3ebSchema = z.string()

const status2fb7baSchema = z.string()

const memberIdsSchema = z.array(assetIdSchema)

const sortOrderedfb74Schema = z.number()

const logoProps61d541Schema = z.json()

const archivedAtdd21a8Schema = z.union([assetIdSchema, id045d22Schema])

const createdAteac330Schema = z.string()

const createdByIdc85a02Schema = z.string()

const startDate4ec926Schema = z.union([assetIdSchema, id045d22Schema])

const targetDate13e2caSchema = z.union([assetIdSchema, id045d22Schema])

const leadId22d0bfSchema = z.union([assetIdSchema, id045d22Schema])

const memberIds840550Schema = z.array(pageIdsItemSchema)

const sortOrder6ecb16Schema = z.union([sortOrderedfb74Schema, access644595Schema])

const logoPropse3e3c2Schema = z.union([logoProps61d541Schema, id045d22Schema])

const isSystemSchema = z.boolean()

const namespaceSchema = z.string()

const permissionsSchema = z.array(assetIdSchema)

const slugSchema = z.string()

const sortOrder5bf4dfSchema = z.number()

export const planeV2PermissionSchemesSchema = z.object({
  description: description36d05fSchema.optional(),
  id: id35193dSchema.optional(),
  is_system: isSystemSchema.optional(),
  name: namef3ca52Schema.optional(),
  namespace: namespaceSchema.optional(),
  permissions: permissionsSchema.optional(),
  slug: slugSchema.optional(),
  sort_order: sortOrder5bf4dfSchema.optional(),
})

const datafc3b83Schema = z.array(planeV2PermissionSchemesSchema)

const actorIdSchema = z.string()

const automationEdgeIdSchema = z.string()

const automationIdSchema = z.string()

const automationNodeIdSchema = z.string()

const automationRunIdSchema = z.string()

const automationScopeSchema = z.string()

const automationVersionIdSchema = z.string()

const epoch0ecdbdSchema = z.number()

const field956f5bSchema = z.string()

const newIdentifieref5ea8Schema = z.string()

const newValue883a22Schema = z.string()

const nodeExecutionIdSchema = z.string()

const oldIdentifier58f8a4Schema = z.string()

const oldValue91bc69Schema = z.string()

const verbc42427Schema = z.string()

export const planeV2ProjectAutomationsSchema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epoch0ecdbdSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
  created_by_id: assetIdSchema.optional(),
  execution_order: access644595Schema.optional(),
  source_node_id: assetIdSchema.optional(),
  target_node_id: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
  version_id: assetIdSchema.optional(),
})

export const planeV2ProjectAutomationsbfbfc7Schema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epoch0ecdbdSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
  config: id045d22Schema.optional(),
  created_by_id: assetIdSchema.optional(),
  handler_name: assetIdSchema.optional(),
  is_enabled: hasPages8e2bc3Schema.optional(),
  last_triggered_at: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  next_scheduled_at: assetIdSchema.optional(),
  node_type: id045d22Schema.optional(),
  updated_at: assetIdSchema.optional(),
  version_id: assetIdSchema.optional(),
})

const projectIds76d572Schema = z.array(defaultValuecb839fSchema)

export const planeV2ProjectAutomations88cd0dSchema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epoch0ecdbdSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
  bot_user_id: assetIdSchema.optional(),
  created_by_id: assetIdSchema.optional(),
  current_version_id: assetIdSchema.optional(),
  description: assetIdSchema.optional(),
  is_enabled: hasPages8e2bc3Schema.optional(),
  is_global: hasPages8e2bc3Schema.optional(),
  last_run_at: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  project_ids: projectIds76d572Schema.optional(),
  run_count: access644595Schema.optional(),
  scope: assetIdSchema.optional(),
  status: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

const epochf145abSchema = z.union([epoch0ecdbdSchema, access644595Schema])

export const planeV2ProjectAutomations5b2254Schema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epochf145abSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
})

const data762d1cSchema = z.array(planeV2ProjectAutomations5b2254Schema)

const datab20d42Schema = z.array(planeV2ProjectAutomationsSchema)

const data7f9216Schema = z.array(planeV2ProjectAutomationsbfbfc7Schema)

const data6bc005Schema = z.array(planeV2ProjectAutomations88cd0dSchema)

const collectionId856ec9Schema = z.string()

const descriptionStrippedba3b79Schema = z.string()

const isLockedca86cfSchema = z.boolean()

const parentId280851Schema = z.string()

const viewProps919a47Schema = z.string()

const viewProps67dac8Schema = z.union([viewProps919a47Schema, id045d22Schema])

const displayFilters1e6323Schema = z.string()

const displayFiltersSchema = z.union([displayFilters1e6323Schema, id045d22Schema])

const displayPropertiesec2639Schema = z.string()

const displayPropertiesSchema = z.union([displayPropertiesec2639Schema, id045d22Schema])

const filtersf4c0e3Schema = z.string()

const filtersSchema = z.union([filtersf4c0e3Schema, id045d22Schema])

const pqlFiltersf432afSchema = z.string()

const pqlFiltersSchema = z.union([pqlFiltersf432afSchema, id045d22Schema])

const query3853e2Schema = z.string()

const querySchema = z.union([query3853e2Schema, id045d22Schema])

const isPublished013d88Schema = z.boolean()

const shortDescriptionSchema = z.string()

const shortIdSchema = z.string()

const templateDataSchema = z.record(z.string(), z.json())

const templateTypeSchema = z.string()

export const planeV2ProjectWorkItemTemplatesSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  id: id35193dSchema.optional(),
  is_published: isPublished013d88Schema.optional(),
  name: namef3ca52Schema.optional(),
  short_description: shortDescriptionSchema.optional(),
  short_id: shortIdSchema.optional(),
  slug: slugSchema.optional(),
  template_data: templateDataSchema.optional(),
  template_type: templateTypeSchema.optional(),
})

const databaa83aSchema = z.array(planeV2ProjectWorkItemTemplatesSchema)

const archiveIn875827Schema = z.number()

const closeIn4103eeSchema = z.number()

const coverImage1c99d0Schema = z.string()

const coverImageUrl4a1253Schema = z.string()

const cycleView2b2a92Schema = z.boolean()

const defaultAssigneeIdSchema = z.string()

const defaultStateIdSchema = z.string()

const emoji40b5b7Schema = z.string()

const guestViewAllFeatures786ecfSchema = z.boolean()

const iconProp7d18beSchema = z.string()

const iconProp8d9de6Schema = z.union([iconProp7d18beSchema, id045d22Schema])

const identifier74e88fSchema = z.string()

const intakeViewadf501Schema = z.boolean()

const isIssueTypeEnabled0467a8Schema = z.boolean()

const isTimeTrackingEnabledc98808Schema = z.boolean()

const issueViewsView9a6da4Schema = z.boolean()

const moduleViewff7a9cSchema = z.boolean()

const networkab7e29Schema = z.number()

const pageView884451Schema = z.boolean()

const projectLeadIdSchema = z.string()

const timezone852348Schema = z.string()

const planeV2CountsSchema = z.record(z.string(), z.json())

const commentHtmlf4a8cbSchema = z.string()

const commentIdSchema = z.string()

const editedAt3206dfSchema = z.string()

const isHiddene48c42Schema = z.boolean()

const isResolved3c3c67Schema = z.boolean()

const releaseIdSchema = z.string()

const planeV2ReleaseCommentsSchema = z.object({
  comment_html: commentHtmlf4a8cbSchema.optional(),
  comment_id: commentIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  edited_at: editedAt3206dfSchema.optional(),
  id: id35193dSchema.optional(),
  is_hidden: isHiddene48c42Schema.optional(),
  is_resolved: isResolved3c3c67Schema.optional(),
  parent_id: parentId280851Schema.optional(),
  release_id: releaseIdSchema.optional(),
})

const dataf71c33Schema = z.array(planeV2ReleaseCommentsSchema)

const planeV2ReleaseLabelsSchema = z.object({
  color: color3938eeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  name: namef3ca52Schema.optional(),
  sort_order: sortOrder5bf4dfSchema.optional(),
})

const data1c20e4Schema = z.array(planeV2ReleaseLabelsSchema)

const metadatabe6a14Schema = z.string()

const metadata64c1b4Schema = z.union([metadatabe6a14Schema, id045d22Schema])

const urlc17248Schema = z.string()

const planeV2ReleaseLinksSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  metadata: metadata64c1b4Schema.optional(),
  release_id: releaseIdSchema.optional(),
  title: titlef754b4Schema.optional(),
  url: urlc17248Schema.optional(),
})

const data1f7f03Schema = z.array(planeV2ReleaseLinksSchema)

const commitHash584d19Schema = z.string()

const gitTag6cd832Schema = z.string()

const version2a0489Schema = z.string()

const planeV2ReleaseTagsSchema = z.object({
  commit_hash: commitHash584d19Schema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  git_tag: gitTag6cd832Schema.optional(),
  id: id35193dSchema.optional(),
  version: version2a0489Schema.optional(),
})

const data202b62Schema = z.array(planeV2ReleaseTagsSchema)

const descriptionIdSchema = z.string()

const isLatest2376d0Schema = z.boolean()

const isPrerelease0a132bSchema = z.boolean()

const releaseDate372b24Schema = z.string()

const status56c139Schema = z.string()

const tagIdSchema = z.string()

const labelIds802308Schema = z.array(assetIdSchema)

const level320d43Schema = z.number()

const namespace02083cSchema = z.union([namespaceSchema, id045d22Schema])

export const planeV2RolesSchema = z.object({
  description: description36d05fSchema.optional(),
  id: id35193dSchema.optional(),
  is_system: isSystemSchema.optional(),
  level: level320d43Schema.optional(),
  name: namef3ca52Schema.optional(),
  namespace: namespace02083cSchema.optional(),
  slug: slugSchema.optional(),
  status: status56c139Schema.optional(),
})

const datac7747aSchema = z.array(planeV2RolesSchema)

const id6acb64Schema = z.string()

const description5b24b0Schema = z.string()

const color742473Schema = z.string()

const groupa33045Schema = z.string()

const sequenced0470fSchema = z.number()

const sequence49ddccSchema = z.union([sequenced0470fSchema, access644595Schema])

const isDefault91f18aSchema = z.boolean()

const isTriage72bb4aSchema = z.boolean()

const createdAtceca3cSchema = z.string()

const createdById3bca72Schema = z.string()

export const planeV2StatesSchema = z.object({
  id: id6acb64Schema.optional(),
  name: name55c8feSchema.optional(),
  description: description5b24b0Schema.optional(),
  color: color742473Schema.optional(),
  group: groupa33045Schema.optional(),
  sequence: sequence49ddccSchema.optional(),
  is_default: isDefault91f18aSchema.optional(),
  is_triage: isTriage72bb4aSchema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAtceca3cSchema.optional(),
  created_by_id: createdById3bca72Schema.optional(),
})

const data283bbfSchema = z.array(planeV2StatesSchema)

const backgroundColor97fcabSchema = z.string()

const ownerIdSchema = z.string()

const planeV2StickiesSchema = z.object({
  background_color: backgroundColor97fcabSchema.optional(),
  color: color3938eeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  description_stripped: descriptionStrippedba3b79Schema.optional(),
  id: id35193dSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  owner_id: ownerIdSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
})

const datadec467Schema = z.array(planeV2StickiesSchema)

const memberIds139e2aSchema = z.array(pageIdsItemSchema)

const assetUrlSchema = z.string()

const attributesd762a0Schema = z.string()

const attributes2ff54bSchema = z.union([attributesd762a0Schema, id045d22Schema])

const contentTypeSchema = z.string()

const entityType7582d6Schema = z.string()

const isUploadedb45807Schema = z.boolean()

const sizec6a674Schema = z.number()

const size422d69Schema = z.union([sizec6a674Schema, access644595Schema])

const userIdSchema = z.string()

export const planeV2UserAssetsSchema = z.object({
  asset_url: assetUrlSchema.optional(),
  attributes: attributes2ff54bSchema.optional(),
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  entity_type: entityType7582d6Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedb45807Schema.optional(),
  name: namef3ca52Schema.optional(),
  size: size422d69Schema.optional(),
  user_id: userIdSchema.optional(),
})

const data02bf8dSchema = z.array(planeV2UserAssetsSchema)

const durationMsSchema = z.number()

const errorMessageSchema = z.string()

const eventTypeSchema = z.string()

const requestBodySchema = z.string()

const requestHeadersSchema = z.string()

const requestMethodSchema = z.string()

const responseBodySchema = z.string()

const responseHeadersSchema = z.string()

const responseStatusSchema = z.string()

const retryCountSchema = z.number()

const statusTextSchema = z.string()

const webhookIdSchema = z.string()

export const planeV2WebhookLogsSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  duration_ms: durationMsSchema.optional(),
  error_message: errorMessageSchema.optional(),
  event_type: eventTypeSchema.optional(),
  id: id35193dSchema.optional(),
  request_body: requestBodySchema.optional(),
  request_headers: requestHeadersSchema.optional(),
  request_method: requestMethodSchema.optional(),
  response_body: responseBodySchema.optional(),
  response_headers: responseHeadersSchema.optional(),
  response_status: responseStatusSchema.optional(),
  retry_count: retryCountSchema.optional(),
  status_text: statusTextSchema.optional(),
  webhook_id: webhookIdSchema.optional(),
})

const data5085a5Schema = z.array(planeV2WebhookLogsSchema)

const scopesSchema = z.array(assetIdSchema)

export const planeV2WebhooksSchema = z.object({
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  is_active: isActive8f30a3Schema.optional(),
  name: namef3ca52Schema.optional(),
  scopes: scopesSchema.optional(),
  url: urlc17248Schema.optional(),
  version: version2a0489Schema.optional(),
})

const data956b74Schema = z.array(planeV2WebhooksSchema)

const comment714233Schema = z.string()

const durationcec84dSchema = z.number()

const issueCommentIdSchema = z.string()

const newIdentifierIdSchema = z.string()

const oldIdentifierIdSchema = z.string()

export const planeV2WorkItemAttachmentsSchema = z.object({
  asset_url: assetUrlSchema.optional(),
  attributes: attributes2ff54bSchema.optional(),
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedb45807Schema.optional(),
  name: namef3ca52Schema.optional(),
  size: size422d69Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
})

const datae25e41Schema = z.array(planeV2WorkItemAttachmentsSchema)

const idddc529Schema = z.string()

const workItemIda2fc32Schema = z.string()

const commentHtml2d6efcSchema = z.string()

const commentStripped14f41eSchema = z.string()

const accessc9a263Schema = z.string()

const createdAt899c85Schema = z.string()

const planeV2WorkItemLinksSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  metadata: metadata64c1b4Schema.optional(),
  title: titlef754b4Schema.optional(),
  url: urlc17248Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
})

const data8c69baSchema = z.array(planeV2WorkItemLinksSchema)

const id064459Schema = z.string()

const name160a8cSchema = z.string()

const displayName049711Schema = z.string()

const descriptiona4aee3Schema = z.string()

const propertyTyped8df30Schema = z.string()

const isMulti384cddSchema = z.boolean()

const isRequiredca803aSchema = z.boolean()

const isActive2fd6ebSchema = z.boolean()

const defaultValueae4c66Schema = z.array(assetIdSchema)

const planeV2OptionsitemSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  description: assetIdSchema.optional(),
  is_default: hasPages8e2bc3Schema.optional(),
  sort_order: access644595Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
})

const options4c14d1Schema = z.array(planeV2OptionsitemSchema)

const settingsafb1a8Schema = z.json()

const planeV2SettingsSchema = z.record(z.string(), z.json())

const settings850707Schema = z.union([settingsafb1a8Schema, planeV2SettingsSchema])

const validationRules715a7aSchema = z.json()

const planeV2ValidationRulesSchema = z.record(z.string(), z.json())

const validationRules5a366bSchema = z.union([
  validationRules715a7aSchema,
  planeV2ValidationRulesSchema,
])

const logoProps4f3d4aSchema = z.json()

const logoProps495565Schema = z.union([logoProps4f3d4aSchema, logoPropsb439a5Schema])

const createdAt1a7dfdSchema = z.string()

export const planeV2WorkItemPropertiesSchema = z.object({
  id: id064459Schema.optional(),
  name: name160a8cSchema.optional(),
  display_name: displayName049711Schema.optional(),
  description: descriptiona4aee3Schema.optional(),
  property_type: propertyTyped8df30Schema.optional(),
  relation_type: cycle883343Schema.optional(),
  is_multi: isMulti384cddSchema.optional(),
  is_required: isRequiredca803aSchema.optional(),
  is_active: isActive2fd6ebSchema.optional(),
  default_value: defaultValueae4c66Schema.optional(),
  options: options4c14d1Schema.optional(),
  settings: settings850707Schema.optional(),
  validation_rules: validationRules5a366bSchema.optional(),
  logo_props: logoProps495565Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1a7dfdSchema.optional(),
})

const relationType21ff68Schema = z.union([assetIdSchema, id045d22Schema])

const planeV2WorkItemProperties3d6810Schema = z.object({
  id: id064459Schema.optional(),
  name: name160a8cSchema.optional(),
  display_name: displayName049711Schema.optional(),
  description: descriptiona4aee3Schema.optional(),
  property_type: propertyTyped8df30Schema.optional(),
  relation_type: relationType21ff68Schema.optional(),
  is_multi: isMulti384cddSchema.optional(),
  is_required: isRequiredca803aSchema.optional(),
  is_active: isActive2fd6ebSchema.optional(),
  default_value: defaultValueae4c66Schema.optional(),
  options: options4c14d1Schema.optional(),
  settings: settings850707Schema.optional(),
  validation_rules: validationRules5a366bSchema.optional(),
  logo_props: logoProps495565Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1a7dfdSchema.optional(),
})

const data6fd798Schema = z.array(planeV2WorkItemProperties3d6810Schema)

const options7065d6Schema = z.array(logoProps44136fSchema)

export const planeV2WorkItemPropertiesa758d8Schema = z.object({
  id: id064459Schema.optional(),
  name: name160a8cSchema.optional(),
  display_name: displayName049711Schema.optional(),
  description: descriptiona4aee3Schema.optional(),
  property_type: propertyTyped8df30Schema.optional(),
  relation_type: cycle883343Schema.optional(),
  is_multi: isMulti384cddSchema.optional(),
  is_required: isRequiredca803aSchema.optional(),
  is_active: isActive2fd6ebSchema.optional(),
  default_value: defaultValueae4c66Schema.optional(),
  options: options7065d6Schema.optional(),
  settings: settings850707Schema.optional(),
  validation_rules: validationRules5a366bSchema.optional(),
  logo_props: logoProps495565Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1a7dfdSchema.optional(),
})

const ida47990Schema = z.string()

const name798d5eSchema = z.string()

const isRequireda7b30dSchema = z.boolean()

const isMulti43f4e4Schema = z.boolean()

const isDefaultd933edSchema = z.boolean()

const defaultValue89f953Schema = z.array(assetIdSchema)

const settings778bc4Schema = z.json()

const settings1f98f7Schema = z.union([settings778bc4Schema, planeV2SettingsSchema])

const sortOrdere1ea1eSchema = z.number()

const sortOrder3f92a1Schema = z.union([sortOrdere1ea1eSchema, access644595Schema])

const appliesToAllProjectsSchema = z.boolean()

const appliesToAllWorkItemTypesSchema = z.boolean()

const createdAt55504eSchema = z.string()

const projectIds2bdf86Schema = z.array(assetIdSchema)

const issueTypeIdsSchema = z.array(assetIdSchema)

const planeV2Optionsitem442d68Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  is_default: hasPages8e2bc3Schema.optional(),
  sort_order: access644595Schema.optional(),
})

const options614fa5Schema = z.array(planeV2Optionsitem442d68Schema)

export const planeV2WorkItemPropertyContextsSchema = z.object({
  id: ida47990Schema.optional(),
  name: name798d5eSchema.optional(),
  is_required: isRequireda7b30dSchema.optional(),
  is_multi: isMulti43f4e4Schema.optional(),
  is_default: isDefaultd933edSchema.optional(),
  default_value: defaultValue89f953Schema.optional(),
  settings: settings1f98f7Schema.optional(),
  sort_order: sortOrder3f92a1Schema.optional(),
  applies_to_all_projects: appliesToAllProjectsSchema.optional(),
  applies_to_all_work_item_types: appliesToAllWorkItemTypesSchema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt55504eSchema.optional(),
  project_ids: projectIds2bdf86Schema.optional(),
  issue_type_ids: issueTypeIdsSchema.optional(),
  options: options614fa5Schema.optional(),
})

const data62c3e9Schema = z.array(planeV2WorkItemPropertyContextsSchema)

const idd4c25aSchema = z.string()

const name85421bSchema = z.string()

const description02f63aSchema = z.string()

const isDefault7f68b1Schema = z.boolean()

const sortOrder6c977aSchema = z.number()

const sortOrderbc200bSchema = z.union([sortOrder6c977aSchema, access644595Schema])

const planeV2WorkItemPropertyOptionsSchema = z.object({
  id: idd4c25aSchema.optional(),
  name: name85421bSchema.optional(),
  description: description02f63aSchema.optional(),
  is_default: isDefault7f68b1Schema.optional(),
  sort_order: sortOrderbc200bSchema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
})

const data313b27Schema = z.array(planeV2WorkItemPropertyOptionsSchema)

const ida6f76cSchema = z.string()

const nameafab81Schema = z.string()

const displayName58548fSchema = z.string()

const propertyType7cf2b6Schema = z.string()

const isRequired70d220Schema = z.boolean()

const isMulti1e30e9Schema = z.boolean()

const isActivedf34faSchema = z.boolean()

const defaultValueb60ad4Schema = z.array(assetIdSchema)

const settings3f3f02Schema = z.json()

const settingse31826Schema = z.union([settings3f3f02Schema, planeV2SettingsSchema])

const validationRules62c8cbSchema = z.json()

const validationRules78f33aSchema = z.union([
  validationRules62c8cbSchema,
  planeV2ValidationRulesSchema,
])

const logoProps7a222dSchema = z.json()

const logoProps5dc883Schema = z.union([logoProps7a222dSchema, logoPropsb439a5Schema])

const optionsf3e53fSchema = z.array(planeV2OptionsitemSchema)

export const planeV2WorkItemTypePropertiesSchema = z.object({
  id: ida6f76cSchema.optional(),
  name: nameafab81Schema.optional(),
  display_name: displayName58548fSchema.optional(),
  description: cycle883343Schema.optional(),
  property_type: propertyType7cf2b6Schema.optional(),
  relation_type: cycle883343Schema.optional(),
  is_required: isRequired70d220Schema.optional(),
  is_multi: isMulti1e30e9Schema.optional(),
  is_active: isActivedf34faSchema.optional(),
  default_value: defaultValueb60ad4Schema.optional(),
  settings: settingse31826Schema.optional(),
  validation_rules: validationRules78f33aSchema.optional(),
  logo_props: logoProps5dc883Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1a7dfdSchema.optional(),
  options: optionsf3e53fSchema.optional(),
})

const datad55667Schema = z.array(planeV2WorkItemTypePropertiesSchema)

const id9503bbSchema = z.string()

const name75d552Schema = z.string()

const description0caf0fSchema = z.string()

const isActive8a5ec5Schema = z.boolean()

const isDefault13e882Schema = z.boolean()

const isEpicbb1a89Schema = z.boolean()

const level7eaf46Schema = z.number()

const levelca2598Schema = z.union([level7eaf46Schema, access644595Schema])

const logoProps669c69Schema = z.json()

const logoPropse15605Schema = z.union([logoProps669c69Schema, logoPropsb439a5Schema])

const createdAtf6a685Schema = z.string()

export const planeV2WorkItemTypesSchema = z.object({
  id: id9503bbSchema.optional(),
  name: name75d552Schema.optional(),
  description: description0caf0fSchema.optional(),
  is_active: isActive8a5ec5Schema.optional(),
  is_default: isDefault13e882Schema.optional(),
  is_epic: isEpicbb1a89Schema.optional(),
  level: levelca2598Schema.optional(),
  logo_props: logoPropse15605Schema.optional(),
  created_at: createdAtf6a685Schema.optional(),
})

const planeV2IconSchema = z.object({
  name: assetIdSchema.optional(),
  background_color: assetIdSchema.optional(),
})

const planeV2TypeLogoPropsSchema = z.object({
  in_use: assetIdSchema.optional(),
  icon: planeV2IconSchema.optional(),
})

const planeV2NameSchema = z.object({
  type: assetIdSchema.optional(),
  required: hasPages8e2bc3Schema.optional(),
  max_length: access644595Schema.optional(),
})

const planeV2DescriptionHtmlSchema = z.object({
  type: assetIdSchema.optional(),
  required: hasPages8e2bc3Schema.optional(),
})

const planeV2Optionsitem3e6e9dSchema = z.object({
  value: assetIdSchema.optional(),
  label: assetIdSchema.optional(),
})

const options58cc7cSchema = z.array(planeV2Optionsitem3e6e9dSchema)

const planeV2PrioritySchema = z.object({
  type: assetIdSchema.optional(),
  required: hasPages8e2bc3Schema.optional(),
  default: assetIdSchema.optional(),
  options: options58cc7cSchema.optional(),
})

const planeV2Optionsitem336915Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  color: assetIdSchema.optional(),
  group: assetIdSchema.optional(),
})

const options09ab48Schema = z.array(planeV2Optionsitem336915Schema)

const planeV2StateIdSchema = z.object({
  type: assetIdSchema.optional(),
  required: hasPages8e2bc3Schema.optional(),
  options: options09ab48Schema.optional(),
})

const planeV2Optionsitem940180Schema = z.object({
  id: assetIdSchema.optional(),
  display_name: assetIdSchema.optional(),
  email: assetIdSchema.optional(),
})

const optionsf9bf03Schema = z.array(planeV2Optionsitem940180Schema)

const planeV2AssigneeIdsSchema = z.object({
  type: assetIdSchema.optional(),
  is_multi: hasPages8e2bc3Schema.optional(),
  required: hasPages8e2bc3Schema.optional(),
  options: optionsf9bf03Schema.optional(),
})

const planeV2Optionsitema430abSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  color: assetIdSchema.optional(),
})

const optionsce8924Schema = z.array(planeV2Optionsitema430abSchema)

const planeV2LabelIdsSchema = z.object({
  type: assetIdSchema.optional(),
  is_multi: hasPages8e2bc3Schema.optional(),
  required: hasPages8e2bc3Schema.optional(),
  options: optionsce8924Schema.optional(),
})

const planeV2StartDateSchema = z.object({
  type: assetIdSchema.optional(),
  required: hasPages8e2bc3Schema.optional(),
  format: assetIdSchema.optional(),
})

const planeV2TargetDateSchema = z.object({
  type: assetIdSchema.optional(),
  required: hasPages8e2bc3Schema.optional(),
  format: assetIdSchema.optional(),
})

const planeV2ParentIdSchema = z.object({
  type: assetIdSchema.optional(),
  required: hasPages8e2bc3Schema.optional(),
})

const planeV2FieldsSchema = z.object({
  name: planeV2NameSchema.optional(),
  description_html: planeV2DescriptionHtmlSchema.optional(),
  priority: planeV2PrioritySchema.optional(),
  state_id: planeV2StateIdSchema.optional(),
  assignee_ids: planeV2AssigneeIdsSchema.optional(),
  label_ids: planeV2LabelIdsSchema.optional(),
  start_date: planeV2StartDateSchema.optional(),
  target_date: planeV2TargetDateSchema.optional(),
  parent_id: planeV2ParentIdSchema.optional(),
})

const data1ba868Schema = z.array(planeV2WorkItemTypesSchema)

const loggedByIdSchema = z.string()

const updatedAt579fb8Schema = z.string()

const idb23e78Schema = z.string()

const name6f7b53Schema = z.string()

const identifier4f4557Schema = z.string()

const sequenceIdfb3d8dSchema = z.number()

const prioritydca6ceSchema = z.string()

const stateId55c66bSchema = z.string()

const assigneeIdsSchema = z.array(assetIdSchema)

const labelIds958cbcSchema = z.array(assetIdSchema)

const parentIde65d55Schema = z.union([assetIdSchema, id045d22Schema])

const isDraft88b48cSchema = z.boolean()

const createdAt083e6eSchema = z.string()

const customFields9c1322Schema = z.union([logoPropsb439a5Schema, id045d22Schema])

const typeIddf3325Schema = z.union([assetIdSchema, id045d22Schema])

const startDate1cc4bcSchema = z.union([assetIdSchema, id045d22Schema])

const archivedAt90ed0eSchema = z.union([assetIdSchema, id045d22Schema])

const assigneesItemSchema = z.object({
  id: assetIdSchema.optional(),
  display_name: assetIdSchema.optional(),
  avatar_url: cycle883343Schema.optional(),
  email: assetIdSchema.optional(),
})

const assigneese6f198Schema = z.array(assigneesItemSchema)

const labelsItemSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  color: assetIdSchema.optional(),
})

const labelsafcc9fSchema = z.array(labelsItemSchema)

const parent31201dSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  sequence_id: access644595Schema.optional(),
})

const parentc31febSchema = z.union([parent31201dSchema, id045d22Schema])

const state3d1b40Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  color: assetIdSchema.optional(),
  group: assetIdSchema.optional(),
})

const statef1f313Schema = z.union([state3d1b40Schema, id045d22Schema])

const logoProps6bd357Schema = z.json()

const type071f88Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  logo_props: logoProps6bd357Schema.optional(),
  is_epic: hasPages8e2bc3Schema.optional(),
})

const typef949c2Schema = z.union([type071f88Schema, id045d22Schema])

const targetDate7254f2Schema = z.union([assetIdSchema, id045d22Schema])

const sequenceId3a1eacSchema = z.union([sequenceIdfb3d8dSchema, assetIdSchema])

const assigneeIds2de275Schema = z.array(pageIdsItemSchema)

const labelIds16374aSchema = z.array(pageIdsItemSchema)

const allowIssueCreationSchema = z.boolean()

const workflowIdSchema = z.string()

export const planeV2WorkflowStatesSchema = z.object({
  allow_issue_creation: allowIssueCreationSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  is_default: isDefault779508Schema.optional(),
  state_id: stateIdddfc84Schema.optional(),
  type: typed8bd3aSchema.optional(),
  workflow_id: workflowIdSchema.optional(),
})

const dataa8c811Schema = z.array(planeV2WorkflowStatesSchema)

const rejectionStateIdSchema = z.string()

const requiredApprovalsSchema = z.number()

const transitionStateIdSchema = z.string()

const workflowStateIdSchema = z.string()

export const planeV2WorkflowTransitionsSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  member_ids: memberIds139e2aSchema.optional(),
  rejection_state_id: rejectionStateIdSchema.optional(),
  required_approvals: requiredApprovalsSchema.optional(),
  transition_state_id: transitionStateIdSchema.optional(),
  workflow_state_id: workflowStateIdSchema.optional(),
})

const data76a8fdSchema = z.array(planeV2WorkflowTransitionsSchema)

const workItemTypeIdsSchema = z.array(pageIdsItemSchema)

export const planeV2WorkflowsSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  id: id35193dSchema.optional(),
  is_active: isActive8f30a3Schema.optional(),
  is_default: isDefault779508Schema.optional(),
  name: namef3ca52Schema.optional(),
  work_item_type_ids: workItemTypeIdsSchema.optional(),
})

const data88dc10Schema = z.array(planeV2WorkflowsSchema)

export const planeV2WorkspaceAssetsSchema = z.object({
  asset_url: assetUrlSchema.optional(),
  attributes: attributes2ff54bSchema.optional(),
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  entity_type: entityType7582d6Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedb45807Schema.optional(),
  name: namef3ca52Schema.optional(),
  size: size422d69Schema.optional(),
})

const datab73db2Schema = z.array(planeV2WorkspaceAssetsSchema)

export const planeV2WorkspaceAutomationsSchema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epoch0ecdbdSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
  created_by_id: assetIdSchema.optional(),
  execution_order: access644595Schema.optional(),
  source_node_id: assetIdSchema.optional(),
  target_node_id: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
  version_id: assetIdSchema.optional(),
})

export const planeV2WorkspaceAutomations96ac73Schema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epoch0ecdbdSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
  config: id045d22Schema.optional(),
  created_by_id: assetIdSchema.optional(),
  handler_name: assetIdSchema.optional(),
  is_enabled: hasPages8e2bc3Schema.optional(),
  last_triggered_at: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  next_scheduled_at: assetIdSchema.optional(),
  node_type: id045d22Schema.optional(),
  updated_at: assetIdSchema.optional(),
  version_id: assetIdSchema.optional(),
})

export const planeV2WorkspaceAutomations86a400Schema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epoch0ecdbdSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
  bot_user_id: assetIdSchema.optional(),
  created_by_id: assetIdSchema.optional(),
  current_version_id: assetIdSchema.optional(),
  description: assetIdSchema.optional(),
  is_enabled: hasPages8e2bc3Schema.optional(),
  is_global: hasPages8e2bc3Schema.optional(),
  last_run_at: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  project_ids: projectIds76d572Schema.optional(),
  run_count: access644595Schema.optional(),
  scope: assetIdSchema.optional(),
  status: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

export const planeV2WorkspaceAutomationsa3e54dSchema = z.object({
  actor_id: actorIdSchema.optional(),
  automation_edge_id: automationEdgeIdSchema.optional(),
  automation_id: automationIdSchema.optional(),
  automation_node_id: automationNodeIdSchema.optional(),
  automation_run_id: automationRunIdSchema.optional(),
  automation_scope: automationScopeSchema.optional(),
  automation_version_id: automationVersionIdSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  epoch: epochf145abSchema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  new_identifier: newIdentifieref5ea8Schema.optional(),
  new_value: newValue883a22Schema.optional(),
  node_execution_id: nodeExecutionIdSchema.optional(),
  old_identifier: oldIdentifier58f8a4Schema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
})

const data92a59eSchema = z.array(planeV2WorkspaceAutomationsa3e54dSchema)

const dataedfcaeSchema = z.array(planeV2WorkspaceAutomationsSchema)

const data23f884Schema = z.array(planeV2WorkspaceAutomations96ac73Schema)

const data307069Schema = z.array(planeV2WorkspaceAutomations86a400Schema)

const idde4acbSchema = z.string()

const isWorkItemTypesEnabledSchema = z.boolean()

const workItemTypeDefaultLevelSchema = z.number()

const isWorkitemHierarchyEnabledSchema = z.boolean()

const isProjectGroupingEnabledSchema = z.boolean()

const isTeamsEnabledSchema = z.boolean()

const isWikiEnabledSchema = z.boolean()

const isInitiativeEnabledSchema = z.boolean()

const isCustomerEnabledSchema = z.boolean()

const isReleaseEnabledSchema = z.boolean()

const isStateDurationEnabledSchema = z.boolean()

const isPiEnabledSchema = z.boolean()

const createdAt15f92dSchema = z.string()

const id48a7c1Schema = z.string()

const name7af2ffSchema = z.string()

const displayName6bc0bdSchema = z.string()

const propertyTypedf003bSchema = z.string()

const isRequired0a4ae5Schema = z.boolean()

const isMulti9ef865Schema = z.boolean()

const isActive76d2f2Schema = z.boolean()

const defaultValue2b7ea7Schema = z.array(assetIdSchema)

const optionsc1b74cSchema = z.array(planeV2OptionsitemSchema)

const settings9146d5Schema = z.json()

const settings78b010Schema = z.union([settings9146d5Schema, planeV2SettingsSchema])

const validationRules647a51Schema = z.json()

const validationRules5f1bf4Schema = z.union([
  validationRules647a51Schema,
  planeV2ValidationRulesSchema,
])

const logoProps60cc42Schema = z.json()

const logoProps912598Schema = z.union([logoProps60cc42Schema, logoPropsb439a5Schema])

export const planeV2WorkspaceWorkItemPropertiesSchema = z.object({
  id: id48a7c1Schema.optional(),
  name: name7af2ffSchema.optional(),
  display_name: displayName6bc0bdSchema.optional(),
  description: cycle883343Schema.optional(),
  property_type: propertyTypedf003bSchema.optional(),
  relation_type: cycle883343Schema.optional(),
  is_required: isRequired0a4ae5Schema.optional(),
  is_multi: isMulti9ef865Schema.optional(),
  is_active: isActive76d2f2Schema.optional(),
  default_value: defaultValue2b7ea7Schema.optional(),
  options: optionsc1b74cSchema.optional(),
  settings: settings78b010Schema.optional(),
  validation_rules: validationRules5f1bf4Schema.optional(),
  logo_props: logoProps912598Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1a7dfdSchema.optional(),
})

const relationTypebdda23Schema = z.union([assetIdSchema, id045d22Schema])

const planeV2WorkspaceWorkItemProperties0fcf87Schema = z.object({
  id: id48a7c1Schema.optional(),
  name: name7af2ffSchema.optional(),
  display_name: displayName6bc0bdSchema.optional(),
  description: cycle883343Schema.optional(),
  property_type: propertyTypedf003bSchema.optional(),
  relation_type: relationTypebdda23Schema.optional(),
  is_required: isRequired0a4ae5Schema.optional(),
  is_multi: isMulti9ef865Schema.optional(),
  is_active: isActive76d2f2Schema.optional(),
  default_value: defaultValue2b7ea7Schema.optional(),
  options: optionsc1b74cSchema.optional(),
  settings: settings78b010Schema.optional(),
  validation_rules: validationRules5f1bf4Schema.optional(),
  logo_props: logoProps912598Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1a7dfdSchema.optional(),
})

const datac76cc1Schema = z.array(planeV2WorkspaceWorkItemProperties0fcf87Schema)

const id2e1beaSchema = z.string()

const name1b19b2Schema = z.string()

const descriptiona7bfc7Schema = z.string()

const isDefault69d320Schema = z.boolean()

const sortOrderb679b9Schema = z.number()

const sortOrderb58f19Schema = z.union([sortOrderb679b9Schema, access644595Schema])

export const planeV2WorkspaceWorkItemPropertyOptionsSchema = z.object({
  id: id2e1beaSchema.optional(),
  name: name1b19b2Schema.optional(),
  description: descriptiona7bfc7Schema.optional(),
  is_default: isDefault69d320Schema.optional(),
  sort_order: sortOrderb58f19Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
})

const dataeee2f9Schema = z.array(planeV2WorkspaceWorkItemPropertyOptionsSchema)

export const planeV2WorkspaceWorkItemTemplatesSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  id: id35193dSchema.optional(),
  is_published: isPublished013d88Schema.optional(),
  name: namef3ca52Schema.optional(),
  short_description: shortDescriptionSchema.optional(),
  short_id: shortIdSchema.optional(),
  slug: slugSchema.optional(),
  template_data: templateDataSchema.optional(),
  template_type: templateTypeSchema.optional(),
})

const data99d8d4Schema = z.array(planeV2WorkspaceWorkItemTemplatesSchema)

const idc46b46Schema = z.string()

const displayNamef547f2Schema = z.string()

const propertyTyped17d25Schema = z.string()

const isActive324d93Schema = z.boolean()

const optionsdfdc65Schema = z.array(planeV2OptionsitemSchema)

export const planeV2WorkspaceWorkItemTypePropertiesSchema = z.object({
  id: idc46b46Schema.optional(),
  name: name7af2ffSchema.optional(),
  display_name: displayNamef547f2Schema.optional(),
  description: cycle883343Schema.optional(),
  property_type: propertyTyped17d25Schema.optional(),
  relation_type: cycle883343Schema.optional(),
  is_required: isRequired0a4ae5Schema.optional(),
  is_multi: isMulti9ef865Schema.optional(),
  is_active: isActive324d93Schema.optional(),
  default_value: defaultValue2b7ea7Schema.optional(),
  options: optionsdfdc65Schema.optional(),
  settings: settings78b010Schema.optional(),
  validation_rules: validationRules5f1bf4Schema.optional(),
  logo_props: logoProps912598Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1a7dfdSchema.optional(),
})

const data6a7b72Schema = z.array(planeV2WorkspaceWorkItemTypePropertiesSchema)

const id24b1a1Schema = z.string()

const description3eb07bSchema = z.string()

const isActive08ed6eSchema = z.boolean()

const isDefaultf90a34Schema = z.boolean()

const isEpic22392bSchema = z.boolean()

const level8e8873Schema = z.number()

const level679529Schema = z.union([level8e8873Schema, access644595Schema])

const logoProps8ff30dSchema = z.json()

const logoPropsbbf5e7Schema = z.union([logoProps8ff30dSchema, logoPropsb439a5Schema])

export const planeV2WorkspaceWorkItemTypesSchema = z.object({
  id: id24b1a1Schema.optional(),
  name: name75d552Schema.optional(),
  description: description3eb07bSchema.optional(),
  is_active: isActive08ed6eSchema.optional(),
  is_default: isDefaultf90a34Schema.optional(),
  is_epic: isEpic22392bSchema.optional(),
  level: level679529Schema.optional(),
  logo_props: logoPropsbbf5e7Schema.optional(),
  created_at: createdAtf6a685Schema.optional(),
})

const data74c95eSchema = z.array(planeV2WorkspaceWorkItemTypesSchema)

const ownedBy4be915Schema = z.union([assetIdSchema, id045d22Schema])

const access09c752Schema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const viewProps8d74f6Schema = z.union([logoPropsb439a5Schema, assetIdSchema, id045d22Schema])

const attrsSchema = z.object({
  id: id045d22Schema.optional(),
  textAlign: id045d22Schema.optional(),
  aiSuggestion: id045d22Schema.optional(),
})

const contentItem598abcSchema = z.object({
  text: assetIdSchema.optional(),
  type: assetIdSchema.optional(),
})

const content430b6dSchema = z.array(contentItem598abcSchema)

const contentItem181a73Schema = z.object({
  type: assetIdSchema.optional(),
  attrs: attrsSchema.optional(),
  content: content430b6dSchema.optional(),
})

const contentbd2ca8Schema = z.array(contentItem181a73Schema)

const descriptionJson0b33adSchema = z.object({
  type: assetIdSchema.optional(),
  content: contentbd2ca8Schema.optional(),
})

export const planePageContentSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  description: descriptionb39dcdSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  owned_by: ownedBy4be915Schema.optional(),
  anchor: anchorSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  projects: projectsSchema.optional(),
  access: access09c752Schema.optional(),
  is_locked: isLockedSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  parent_id: parentIdSchema.optional(),
  collection_id: collectionIdSchema.optional(),
  page_collection_id: pageCollectionIdSchema.optional(),
  color: assetIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: id045d22Schema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: id045d22Schema.optional(),
  external_source: id045d22Schema.optional(),
  description_json: descriptionJson0b33adSchema.optional(),
})

const assigneesItem3fe93dSchema = z.object({
  id: assetIdSchema.optional(),
  first_name: assetIdSchema.optional(),
  last_name: assetIdSchema.optional(),
  email: assetIdSchema.optional(),
  avatar: assetIdSchema.optional(),
  avatar_url: id045d22Schema.optional(),
  display_name: assetIdSchema.optional(),
})

const assigneesItemfe7e56Schema = z.union([assetIdSchema, assigneesItem3fe93dSchema])

const assigneesb359d4Schema = z.array(assigneesItemfe7e56Schema)

const assignees22e466Schema = z.array(userLiteSchema)

const assigneesa64957Schema = z.union([assigneesb359d4Schema, assignees22e466Schema])

const labelsItem7d556aSchema = z.object({
  id: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
  deleted_at: id045d22Schema.optional(),
  name: assetIdSchema.optional(),
  description: assetIdSchema.optional(),
  color: assetIdSchema.optional(),
  sort_order: sortOrderdde3e5Schema.optional(),
  external_source: id045d22Schema.optional(),
  external_id: id045d22Schema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: id045d22Schema.optional(),
  workspace: assetIdSchema.optional(),
  project: assetIdSchema.optional(),
  parent: id045d22Schema.optional(),
})

const labelsItema42358Schema = z.union([assetIdSchema, labelsItem7d556aSchema])

const labels3303c8Schema = z.array(labelsItema42358Schema)

const parent6f1635Schema = z.union([assetIdSchema, id045d22Schema])

export const labelb4435fSchema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  color: colorSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  project: project0bf380Schema.optional(),
  parent: parent6f1635Schema.optional(),
  deleted_by: id045d22Schema.optional(),
})

const labels966c4aSchema = z.array(labelb4435fSchema)

const labels283edfSchema = z.union([labels3303c8Schema, labels966c4aSchema])

const sequenceId6a702bSchema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const project30aa14Schema = z.union([assetIdSchema, settings43c814Schema, id045d22Schema])

const state7452d8Schema = z.union([assetIdSchema, stateLiteSchema, id045d22Schema])

const estimatePoint1c3278Schema = z.union([assetIdSchema, id045d22Schema])

const cycleIdSchema = z.union([id045d22Schema, assetIdSchema])

const priorityRankSchema = z.union([sortOrderdde3e5Schema, id045d22Schema])

export const planeWorkItemContentSchema = z.object({
  id: idSchema.optional(),
  assignees: assigneesa64957Schema.optional(),
  labels: labels283edfSchema.optional(),
  type_id: typeIdSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  point: pointSchema.optional(),
  name: nameSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  priority: priority7c079dSchema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  sequence_id: sequenceId6a702bSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  completed_at: completedAtSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  is_draft: isDraftSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project30aa14Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  parent: parent6f1635Schema.optional(),
  state: state7452d8Schema.optional(),
  estimate_point: estimatePoint1c3278Schema.optional(),
  type: typeSchema.optional(),
  description: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
  cycle_id: cycleIdSchema.optional(),
  created_via: id045d22Schema.optional(),
  updated_via: id045d22Schema.optional(),
  last_activity_at: assetIdSchema.optional(),
  min_assignee_first_name: cycleIdSchema.optional(),
  min_label_name: cycleIdSchema.optional(),
  min_module_name: cycleIdSchema.optional(),
  priority_rank: priorityRankSchema.optional(),
  state_group: cycle883343Schema.optional(),
})

export const planeV2V2PublishArtifactresultSchema = z.object({
  anchor: assetIdSchema.optional(),
  is_active: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListAuditLogsresultSchema = z.object({
  data: dataSchema.optional(),
  next: access644595Schema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2GetCurrentUserresultbff3bfSchema = z.object({
  id: cycle883343Schema.optional(),
  email: cycle883343Schema.optional(),
  display_name: cycle883343Schema.optional(),
  principal_kind: assetIdSchema.optional(),
  scopes: defaultValuecb839fSchema.optional(),
  first_name: firstNameSchema.optional(),
  last_name: lastNameSchema.optional(),
  avatar: avatarSchema.optional(),
  avatar_url: avatarUrlSchema.optional(),
})

const planeV2Collectionsebefa1Schema = z.object({
  access: access97d6dbSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  is_default: isDefault779508Schema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  page_ids: pageIdsSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  owned_by: customFields9c1322Schema.optional(),
})

const accessb23b23Schema = z.union([access97d6dbSchema, collectionAccessEnumSchema, id045d22Schema])

const createdAt88654eSchema = z.union([createdAt50e5d2Schema, assetIdSchema, id045d22Schema])

const id835e8aSchema = z.union([id35193dSchema, assetIdSchema, id045d22Schema])

const isDefaultd71aa4Schema = z.union([isDefault779508Schema, hasPages8e2bc3Schema, id045d22Schema])

const isGlobal3c2449Schema = z.union([isGlobal48e7dfSchema, hasPages8e2bc3Schema, id045d22Schema])

const logoProps5b72a8Schema = z.union([
  logoPropsb599b9Schema,
  id045d22Schema,
  logoProps44136fSchema,
])

const name8b7867Schema = z.union([namef3ca52Schema, assetIdSchema, id045d22Schema])

const ownedByIdedaa1aSchema = z.union([ownedById53bb5aSchema, assetIdSchema, id045d22Schema])

const sortOrder9643a4Schema = z.union([
  sortOrder7c3a9eSchema,
  access644595Schema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

const currentUserAccessddfa7dSchema = z.union([collectionMemberAccessEnumSchema, id045d22Schema])

export const planeV2Collections2745f2Schema = z.object({
  access: accessb23b23Schema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id835e8aSchema.optional(),
  is_default: isDefaultd71aa4Schema.optional(),
  is_global: isGlobal3c2449Schema.optional(),
  logo_props: logoProps5b72a8Schema.optional(),
  name: name8b7867Schema.optional(),
  owned_by_id: ownedByIdedaa1aSchema.optional(),
  page_ids: pageIdsSchema.optional(),
  sort_order: sortOrder9643a4Schema.optional(),
  owned_by: customFields9c1322Schema.optional(),
  current_user_access: currentUserAccessddfa7dSchema.optional(),
  has_pages: hasPagesSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
})

const member374e5aSchema = z.union([assigneesItemSchema, id045d22Schema])

export const planeV2Collections02f138Schema = z.object({
  access: access97d6dbSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id35193dSchema.optional(),
  is_default: isDefault779508Schema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  logo_props: logoPropsb599b9Schema.optional(),
  name: namef3ca52Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  page_ids: pageIdsd23a08Schema.optional(),
  sort_order: sortOrder7c3a9eSchema.optional(),
  collection_id: assetIdSchema.optional(),
  member_id: assetIdSchema.optional(),
  source: assetIdSchema.optional(),
  member: member374e5aSchema.optional(),
})

const member19062fSchema = z.union([assetIdSchema, id045d22Schema])

const access386f79Schema = z.union([collectionMemberAccessEnumSchema, id045d22Schema])

export const collectionMembera1654fSchema = z.object({
  id: idSchema.optional(),
  collection: collectionSchema.optional(),
  member: member19062fSchema.optional(),
  access: access386f79Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
})

const dataf9c0e0Schema = z.array(planeV2Collectionsebefa1Schema)

export const planeV2V2ListCollectionsresultSchema = z.object({
  data: dataf9c0e0Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const accessc33c22Schema = z.union([collectionAccessEnumSchema, id045d22Schema])

const currentUserAccess56fa2aSchema = z.union([collectionMemberAccessEnumSchema, id045d22Schema])

export const collectionaec678Schema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  owned_by_id: ownedByIdSchema.optional(),
  access: accessc33c22Schema.optional(),
  current_user_access: currentUserAccess56fa2aSchema.optional(),
  has_pages: hasPagesSchema.optional(),
  is_default: isDefaultSchema.optional(),
  is_global: isGlobalSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
})

export const planeV2V2ManageCollectionMembersresult8b24a1Schema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
  id: idSchema.optional(),
  collection: collectionSchema.optional(),
  member: member19062fSchema.optional(),
  access: currentUserAccessddfa7dSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
})

export const planeV2V2ManageCollectionPagesresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

export const collectionPaged68582Schema = z.object({
  id: idSchema.optional(),
  collection: collectionSchema.optional(),
  page: pageSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  sort_order: sortOrderSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
})

const customerPropertyOption519661Schema = z.object({
  id: idSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  sort_order: sortOrderSchema.optional(),
  description: descriptionSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  is_active: isActiveSchema.optional(),
  is_default: isDefaultSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  property: propertySchema.optional(),
  parent: parent6f1635Schema.optional(),
})

const defaultValue20e6a2Schema = z.union([id045d22Schema, defaultValue90f256Schema])

const description16907bSchema = z.union([description36d05fSchema, assetIdSchema, id045d22Schema])

const isActive453a5bSchema = z.union([isActive8f30a3Schema, hasPages8e2bc3Schema, id045d22Schema])

const isMulti05ba07Schema = z.union([isMulti4435adSchema, hasPages8e2bc3Schema, id045d22Schema])

const isRequired905ee1Schema = z.union([
  isRequiredc272a8Schema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const optionsItem4b6f15Schema = z.union([
  assetIdSchema,
  id045d22Schema,
  customerPropertyOption519661Schema,
])

const options4b2339Schema = z.array(optionsItem4b6f15Schema)

const options860b5aSchema = z.union([id045d22Schema, options4b2339Schema])

const relationTypec72486Schema = z.union([
  relationTypec98a3cSchema,
  id045d22Schema,
  customerRelationTypeSchema,
])

const settings3253a1Schema = z.union([
  settings2b72dcSchema,
  id045d22Schema,
  settings43c814Schema,
  textAttributeSettingsSchema,
])

const validationRules502845Schema = z.union([
  validationRules2bb568Schema,
  id045d22Schema,
  logoProps44136fSchema,
])

export const planeV2CustomerProperties2dc1f6Schema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  default_value: defaultValue20e6a2Schema.optional(),
  description: description16907bSchema.optional(),
  display_name: displayName940d5dSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  is_active: isActive453a5bSchema.optional(),
  is_multi: isMulti05ba07Schema.optional(),
  is_required: isRequired905ee1Schema.optional(),
  logo_props: logoProps5b72a8Schema.optional(),
  name: name8b7867Schema.optional(),
  options: options860b5aSchema.optional(),
  property_type: propertyType80786bSchema.optional(),
  relation_type: relationTypec72486Schema.optional(),
  settings: settings3253a1Schema.optional(),
  sort_order: sortOrder9643a4Schema.optional(),
  validation_rules: validationRules502845Schema.optional(),
  deleted_at: deletedAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
})

export const planeV2V2ListCustomerPropertiesresultSchema = z.object({
  data: data029d9cSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const relationTypec3fad1Schema = z.union([customerRelationTypeSchema, id045d22Schema])

const settingsdd9594Schema = z.union([
  textAttributeSettingsSchema,
  dateAttributeSettingsSchema,
  settings43c814Schema,
  id045d22Schema,
])

const options602835Schema = z.array(customerPropertyOption519661Schema)

const optionsee239bSchema = z.union([options602835Schema, id045d22Schema])

export const customerProperty195984Schema = z.object({
  id: idSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  name: nameSchema.optional(),
  display_name: displayNamed4d29dSchema.optional(),
  description: descriptionSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  property_type: customerPropertyTypeSchema.optional(),
  relation_type: relationTypec3fad1Schema.optional(),
  is_required: isRequiredSchema.optional(),
  default_value: defaultValueSchema.optional(),
  settings: settingsdd9594Schema.optional(),
  is_active: isActiveSchema.optional(),
  is_multi: isMultiSchema.optional(),
  validation_rules: validationRulesSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  options: optionsee239bSchema.optional(),
})

const planeV2V2ListCustomerPropertyValuesresultSchema = z.record(z.string(), z.json())

export const listCustomerPropertyValuesResultSchema = z.union([
  planeV2V2ListCustomerPropertyValuesresultSchema,
  planeListCustomerPropertyValuesResultSchema,
])

const description32d9d3Schema = z.union([
  description36d05fSchema,
  logoProps44136fSchema,
  id045d22Schema,
])

const descriptionHtml605ec1Schema = z.union([
  descriptionHtml92a7e9Schema,
  assetIdSchema,
  id045d22Schema,
])

const link42216bSchema = z.union([link2173c1Schema, assetIdSchema, id045d22Schema])

export const planeV2CustomerRequests7999a5Schema = z.object({
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  customer_id: customerIdSchema.optional(),
  description: description32d9d3Schema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  id: id835e8aSchema.optional(),
  link: link42216bSchema.optional(),
  name: namef3ca52Schema.optional(),
  work_item_ids: workItemIdsSchema.optional(),
  attachment_count: attachmentCountSchema.optional(),
  description_stripped: assetIdSchema.optional(),
  email: assetIdSchema.optional(),
  website_url: assetIdSchema.optional(),
  logo_props: assetIdSchema.optional(),
  domain: assetIdSchema.optional(),
  employees: access644595Schema.optional(),
  stage: assetIdSchema.optional(),
  contract_status: assetIdSchema.optional(),
  revenue: assetIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
  logo_asset: assetIdSchema.optional(),
})

export const planeV2V2ListCustomerRequestsresultSchema = z.object({
  data: data22acecSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const customere0e1edSchema = z.object({
  id: idSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  customer_request_count: customerRequestCountSchema.optional(),
  logo_url: logoUrlSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: description2c8fe8Schema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  email: emailSchema.optional(),
  website_url: websiteUrlSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  domain: domainSchema.optional(),
  employees: employeesSchema.optional(),
  stage: stageSchema.optional(),
  contract_status: contractStatusSchema.optional(),
  revenue: revenueSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  logo_asset: logoAssetSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
})

const contractStatus90b0ceSchema = z.union([
  contractStatus47b242Schema,
  assetIdSchema,
  id045d22Schema,
])

const customerRequestCount02fbfbSchema = z.union([
  customerRequestCount53613dSchema,
  access644595Schema,
  id045d22Schema,
])

const domain3634c5Schema = z.union([domain08310aSchema, assetIdSchema, id045d22Schema])

const email0f5291Schema = z.union([email0e37edSchema, assetIdSchema, id045d22Schema])

const employees5d28b5Schema = z.union([employeesbde09aSchema, access644595Schema, id045d22Schema])

const logoUrl952136Schema = z.union([logoUrle1f9ccSchema, assetIdSchema, id045d22Schema])

const revenue05f1c2Schema = z.union([revenuedc4a8cSchema, assetIdSchema, id045d22Schema])

const stagea8c578Schema = z.union([stagef8ed88Schema, assetIdSchema, id045d22Schema])

const websiteUrl798b3aSchema = z.union([websiteUrldbbbffSchema, assetIdSchema, id045d22Schema])

export const planeV2Customers8e07c4Schema = z.object({
  archived_at: cycle883343Schema.optional(),
  contract_status: contractStatus90b0ceSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  customer_request_count: customerRequestCount02fbfbSchema.optional(),
  description: description32d9d3Schema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  domain: domain3634c5Schema.optional(),
  email: email0f5291Schema.optional(),
  employees: employees5d28b5Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  logo_asset_id: logoAssetIdSchema.optional(),
  logo_props: logoProps5b72a8Schema.optional(),
  logo_url: logoUrl952136Schema.optional(),
  name: namef3ca52Schema.optional(),
  revenue: revenue05f1c2Schema.optional(),
  stage: stagea8c578Schema.optional(),
  website_url: websiteUrl798b3aSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  logo_asset: logoAssetSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
})

export const planeV2V2ListCustomersresultSchema = z.object({
  data: dataddaf7aSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ManageCustomerWorkItemsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

export const planeV2V2BulkCreateCyclesresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteCyclesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateCyclesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

const planeV2Cyclesa5e38dSchema = z.object({
  id: idc6ba9cSchema.optional(),
  name: name55c8feSchema.optional(),
  description: description1faa98Schema.optional(),
  start_date: cycle883343Schema.optional(),
  end_date: cycle883343Schema.optional(),
  timezone: timezonec2812eSchema.optional(),
  owned_by_id: ownedById907ebbSchema.optional(),
  sort_order: sortOrder50ad65Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt8a8d4fSchema.optional(),
  created_by_id: createdByIdde9d3fSchema.optional(),
  owned_by: customFields9c1322Schema.optional(),
})

const totalIssuesf869cfSchema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const cancelledIssues7d6f65Schema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const completedIssuesee96dfSchema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const startedIssuesd50eceSchema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const unstartedIssues906046Schema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const backlogIssuesa57784Schema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const progressSnapshot9e2fcdSchema = z.record(z.string(), z.json())

const progressSnapshotdfbb25Schema = z.union([
  logoProps44136fSchema,
  id045d22Schema,
  progressSnapshot9e2fcdSchema,
])

const version4b055bSchema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

export const cycle857a4cSchema = z.object({
  id: idSchema.optional(),
  total_issues: totalIssuesf869cfSchema.optional(),
  cancelled_issues: cancelledIssues7d6f65Schema.optional(),
  completed_issues: completedIssuesee96dfSchema.optional(),
  started_issues: startedIssuesd50eceSchema.optional(),
  unstarted_issues: unstartedIssues906046Schema.optional(),
  backlog_issues: backlogIssuesa57784Schema.optional(),
  total_estimates: totalEstimatesSchema.optional(),
  completed_estimates: completedEstimatesSchema.optional(),
  started_estimates: startedEstimatesSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  start_date: startDateSchema.optional(),
  end_date: endDateSchema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  sort_order: sortOrderSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  progress_snapshot: progressSnapshotdfbb25Schema.optional(),
  archived_at: archivedAtSchema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  timezone: timezoneSchema.optional(),
  version: version4b055bSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  owned_by: ownedBy4be915Schema.optional(),
  status: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
})

const idb26c2bSchema = z.union([idc6ba9cSchema, assetIdSchema, id045d22Schema])

const descriptionf5efb4Schema = z.union([description1faa98Schema, assetIdSchema, id045d22Schema])

const timezonea90eedSchema = z.union([timezonec2812eSchema, assetIdSchema, id045d22Schema])

const sortOrderf32603Schema = z.union([
  sortOrder74b257Schema,
  access644595Schema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

const createdAt9bd04eSchema = z.union([createdAt8a8d4fSchema, assetIdSchema, id045d22Schema])

const ownedBy18e538Schema = z.union([logoPropsb439a5Schema, id045d22Schema, assetIdSchema])

export const planeV2Cycles6d6772Schema = z.object({
  id: idb26c2bSchema.optional(),
  name: name55c8feSchema.optional(),
  description: descriptionf5efb4Schema.optional(),
  start_date: cycle883343Schema.optional(),
  end_date: cycle883343Schema.optional(),
  timezone: timezonea90eedSchema.optional(),
  owned_by_id: ownedById907ebbSchema.optional(),
  sort_order: sortOrderf32603Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt9bd04eSchema.optional(),
  created_by_id: createdByIdde9d3fSchema.optional(),
  owned_by: ownedBy18e538Schema.optional(),
  total_issues: totalIssuesf869cfSchema.optional(),
  cancelled_issues: cancelledIssues7d6f65Schema.optional(),
  completed_issues: completedIssuesee96dfSchema.optional(),
  started_issues: startedIssuesd50eceSchema.optional(),
  unstarted_issues: unstartedIssues906046Schema.optional(),
  backlog_issues: backlogIssuesa57784Schema.optional(),
  total_estimates: totalEstimatesSchema.optional(),
  completed_estimates: completedEstimatesSchema.optional(),
  started_estimates: startedEstimatesSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  progress_snapshot: progressSnapshotdfbb25Schema.optional(),
  archived_at: archivedAtSchema.optional(),
  version: version4b055bSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  status: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
})

const data046e2eSchema = z.array(planeV2Cyclesa5e38dSchema)

export const planeV2V2ListCyclesresultSchema = z.object({
  data: data046e2eSchema.optional(),
  next: access644595Schema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ManageCycleWorkItemsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

const subIssuesCount160d64Schema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

export const cycleWorkItem52a223Schema = z.object({
  id: idSchema.optional(),
  sub_issues_count: subIssuesCount160d64Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  cycle: cycleSchema.optional(),
  deleted_by: id045d22Schema.optional(),
})

export const planeV2V2TransferCycleWorkItemsresultdf206aSchema = z.object({
  new_cycle_id: assetIdSchema.optional(),
  message: assetIdSchema.optional(),
})

export const planeV2Cyclesee71cbSchema = z.object({
  id: idc6ba9cSchema.optional(),
  name: name55c8feSchema.optional(),
  description: description1faa98Schema.optional(),
  start_date: cycle883343Schema.optional(),
  end_date: cycle883343Schema.optional(),
  timezone: timezonec2812eSchema.optional(),
  owned_by_id: ownedById907ebbSchema.optional(),
  sort_order: sortOrder50ad65Schema.optional(),
  logo_props: logoPropsa76dcbSchema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt8a8d4fSchema.optional(),
  created_by_id: createdByIdde9d3fSchema.optional(),
  owned_by: customFields9c1322Schema.optional(),
})

export const planeV2V2BulkCreateEstimatePointsresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteEstimatePointsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateEstimatePointsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2ListEstimatePointsresultSchema = z.object({
  data: data735e56Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const estimatePointbb0ee0Schema = z.object({
  id: idSchema.optional(),
  estimate: estimateSchema.optional(),
  key: keySchema.optional(),
  value: valueSchema.optional(),
  description: descriptionSchema.optional(),
  external_id: externalIdSchema.optional(),
  external_source: externalSourceSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
})

const key8c96a1Schema = z.union([keyaae3a0Schema, access644595Schema, id045d22Schema])

export const planeV2EstimatePointsb9f075Schema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description16907bSchema.optional(),
  estimate_id: estimateIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  key: key8c96a1Schema.optional(),
  value: valuef92da1Schema.optional(),
  estimate: estimateSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
})

export const planeV2V2BulkCreateEstimatesresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteEstimatesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateEstimatesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

const pointsSchema = z.array(logoPropsb439a5Schema)

export const planeV2Estimatesb76797Schema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  last_used: lastUsed35601dSchema.optional(),
  name: namef3ca52Schema.optional(),
  type: typed8bd3aSchema.optional(),
  points: pointsSchema.optional(),
})

const lastUsed6251deSchema = z.union([lastUsed35601dSchema, hasPages8e2bc3Schema, id045d22Schema])

const type33a486Schema = z.union([typed8bd3aSchema, assetIdSchema, id045d22Schema])

export const planeV2Estimates78fed1Schema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description16907bSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  last_used: lastUsed6251deSchema.optional(),
  name: namef3ca52Schema.optional(),
  type: type33a486Schema.optional(),
  points: pointsSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
})

const data92f00eSchema = z.array(planeV2Estimatesb76797Schema)

export const planeV2V2ListEstimatesresultfda80bSchema = z.object({
  data: data92f00eSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
  id: idSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  type: type0858aeSchema.optional(),
  last_used: lastUsedSchema.optional(),
  external_id: externalIdSchema.optional(),
  external_source: externalSourceSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
})

export const planeV2GroupSync21af09Schema = z.object({
  auto_remove: autoRemoveSchema.optional(),
  default_workspace_role_slug: defaultWorkspaceRoleSlugSchema.optional(),
  group_attribute_key: groupAttributeKeySchema.optional(),
  id: id35193dSchema.optional(),
  is_enabled: isEnabledSchema.optional(),
  sync_offline: syncOfflineSchema.optional(),
  sync_on_login: syncOnLoginSchema.optional(),
  all_projects: hasPages8e2bc3Schema.optional(),
  created_at: assetIdSchema.optional(),
  idp_group_name: assetIdSchema.optional(),
  project_id: assetIdSchema.optional(),
  role_slug: assetIdSchema.optional(),
  project: assetIdSchema.optional(),
  role: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

export const planeV2GroupSync997fe5Schema = z.object({
  auto_remove: autoRemoveSchema.optional(),
  default_workspace_role_slug: defaultWorkspaceRoleSlugSchema.optional(),
  group_attribute_key: groupAttributeKeySchema.optional(),
  id: id35193dSchema.optional(),
  is_enabled: isEnabledSchema.optional(),
  sync_offline: syncOfflineSchema.optional(),
  sync_on_login: syncOnLoginSchema.optional(),
  created_at: assetIdSchema.optional(),
  idp_group_name: assetIdSchema.optional(),
  role_slug: assetIdSchema.optional(),
  role: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

export const planeV2GroupSync460c90Schema = z.object({
  auto_remove: autoRemoveSchema.optional(),
  default_workspace_role_slug: defaultWorkspaceRoleSlugSchema.optional(),
  group_attribute_key: groupAttributeKeySchema.optional(),
  id: id35193dSchema.optional(),
  is_enabled: isEnabledSchema.optional(),
  sync_offline: syncOfflineSchema.optional(),
  sync_on_login: syncOnLoginSchema.optional(),
  default_workspace_role: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

export const planeV2V2ListProjectMappingsresultSchema = z.object({
  data: data73f281Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeListProjectMappingsResultItem51e494Schema = z.object({
  id: assetIdSchema.optional(),
  idp_group_name: assetIdSchema.optional(),
  project: cycle883343Schema.optional(),
  all_projects: hasPages8e2bc3Schema.optional(),
  role: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

export const planeV2V2ListWorkspaceMappingsresultSchema = z.object({
  data: data3412d8Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const initiativeLabel4c6facSchema = z.object({
  id: ide04262Schema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  color: colorSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  workspace: workspace259123Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
})

const color7410a0Schema = z.union([color3938eeSchema, assetIdSchema, id045d22Schema])

export const planeV2InitiativeLabelsc1e575Schema = z.object({
  color: color7410a0Schema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description16907bSchema.optional(),
  id: id35193dSchema.optional(),
  name: namef3ca52Schema.optional(),
  sort_order: sortOrder9643a4Schema.optional(),
  workspace: workspace259123Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
})

export const planeV2V2ListInitiativeLabelsresultSchema = z.object({
  data: data75cbc7Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const initiativeLabelf98cdbSchema = z.object({
  id: ide04262Schema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  color: colorSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  workspace: workspace259123Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  grouped_by: assetIdSchema.optional(),
  sub_grouped_by: assetIdSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: assetIdSchema.optional(),
  prev_cursor: assetIdSchema.optional(),
  next_page_results: hasPages8e2bc3Schema.optional(),
  prev_page_results: hasPages8e2bc3Schema.optional(),
  count: access644595Schema.optional(),
  total_pages: access644595Schema.optional(),
  total_results: access644595Schema.optional(),
  extra_stats: extraStatsSchema.optional(),
  results: resultsSchema.optional(),
})

const planeV2Initiativesf5b822Schema = z.object({
  archived_at: archivedAt31ccceSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  end_date: endDate9dd74eSchema.optional(),
  id: id35193dSchema.optional(),
  label_ids: labelIds7d9fa4Schema.optional(),
  lead_id: leadIdSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  project_ids: projectIdsa92388Schema.optional(),
  start_date: startDate43e866Schema.optional(),
  state: state43f46dSchema.optional(),
  lead: customFields9c1322Schema.optional(),
})

const endDated4326fSchema = z.union([endDate9dd74eSchema, assetIdSchema, id045d22Schema])

const logoPropscc3180Schema = z.union([
  logoPropsb599b9Schema,
  id045d22Schema,
  logoPropsf7fcccSchema,
])

const startDate33d50aSchema = z.union([startDate43e866Schema, assetIdSchema, id045d22Schema])

const state299552Schema = z.union([state43f46dSchema, initiativeStateSchema, id045d22Schema])

export const planeV2Initiatives26c543Schema = z.object({
  archived_at: archivedAt31ccceSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description16907bSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  end_date: endDated4326fSchema.optional(),
  id: id35193dSchema.optional(),
  label_ids: labelIds7d9fa4Schema.optional(),
  lead_id: leadIdSchema.optional(),
  logo_props: logoPropscc3180Schema.optional(),
  name: namef3ca52Schema.optional(),
  project_ids: projectIdsa92388Schema.optional(),
  start_date: startDate33d50aSchema.optional(),
  state: state299552Schema.optional(),
  lead: ownedBy18e538Schema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinary7500edSchema.optional(),
  workspace: workspace259123Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
})

const data25980bSchema = z.array(planeV2Initiativesf5b822Schema)

export const planeV2V2ListInitiativesresultSchema = z.object({
  data: data25980bSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const stated27be2Schema = z.union([initiativeStateSchema, id045d22Schema])

export const initiativef4aa07Schema = z.object({
  id: ide04262Schema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinary7500edSchema.optional(),
  start_date: startDateSchema.optional(),
  end_date: endDateSchema.optional(),
  logo_props: logoPropsf7fcccSchema.optional(),
  state: stated27be2Schema.optional(),
  lead: leadSchema.optional(),
  workspace: workspace259123Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  grouped_by: assetIdSchema.optional(),
  sub_grouped_by: assetIdSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: assetIdSchema.optional(),
  prev_cursor: assetIdSchema.optional(),
  next_page_results: hasPages8e2bc3Schema.optional(),
  prev_page_results: hasPages8e2bc3Schema.optional(),
  count: access644595Schema.optional(),
  total_pages: access644595Schema.optional(),
  total_results: access644595Schema.optional(),
  extra_stats: extraStatsSchema.optional(),
  results: resultsSchema.optional(),
})

export const planeV2V2ManageInitiativeLabelsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

export const planeV2V2ManageInitiativeProjectsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

const defaultAssignee13325eSchema = z.union([assetIdSchema, id045d22Schema])

const projectLeadaf8c35Schema = z.union([assetIdSchema, id045d22Schema])

export const project51fea9Schema = z.object({
  id: idSchema.optional(),
  total_members: totalMembersSchema.optional(),
  total_cycles: totalCyclesSchema.optional(),
  total_modules: totalModulesSchema.optional(),
  is_member: isMemberSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  member_role: memberRoleSchema.optional(),
  is_deployed: isDeployedSchema.optional(),
  cover_image_url: coverImageUrlSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  description_text: descriptionTextSchema.optional(),
  description_html: descriptionHtmlfa4901Schema.optional(),
  network: networkSchema.optional(),
  identifier: identifierSchema.optional(),
  emoji: emojiSchema.optional(),
  icon_prop: iconPropSchema.optional(),
  module_view: moduleViewSchema.optional(),
  cycle_view: cycleViewSchema.optional(),
  issue_views_view: issueViewsViewSchema.optional(),
  page_view: pageViewSchema.optional(),
  intake_view: intakeViewSchema.optional(),
  is_time_tracking_enabled: isTimeTrackingEnabledSchema.optional(),
  is_issue_type_enabled: isIssueTypeEnabledSchema.optional(),
  guest_view_all_features: guestViewAllFeaturesSchema.optional(),
  cover_image: coverImageSchema.optional(),
  archive_in: archiveInSchema.optional(),
  close_in: closeInSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  timezone: timezone7677ddSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  default_assignee: defaultAssignee13325eSchema.optional(),
  project_lead: projectLeadaf8c35Schema.optional(),
  cover_image_asset: coverImageAssetSchema.optional(),
  estimate: estimateSchema.optional(),
  default_state: defaultStateSchema.optional(),
})

export const planeV2V2ManageInitiativeWorkItemsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

const moduleLiteab5dabSchema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  description_text: descriptionTextSchema.optional(),
  description_html: descriptionHtmlfa4901Schema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  status: statusSchema.optional(),
  view_props: viewPropsSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project4c8ec3Schema.optional(),
  workspace: workspace259123Schema.optional(),
  lead: leadSchema.optional(),
  members: membersSchema.optional(),
})

const labelefdebcSchema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  color: colorSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  project: project0bf380Schema.optional(),
  parent: parent6f1635Schema.optional(),
})

const snoozedTill2b3739Schema = z.union([snoozedTill5f1342Schema, assetIdSchema, id045d22Schema])

const source0190a9Schema = z.union([source6c208dSchema, assetIdSchema, id045d22Schema])

const sourceEmail6368deSchema = z.union([sourceEmaila6f632Schema, assetIdSchema, id045d22Schema])

const status9caf13Schema = z.union([status065e3cSchema, access644595Schema, id045d22Schema])

const module3602c7Schema = z.union([moduleLiteab5dabSchema, id045d22Schema])

const labels185c26Schema = z.array(labelefdebcSchema)

const labels13d966Schema = z.union([defaultValuecb839fSchema, labels185c26Schema, id045d22Schema])

const assignees0a93f0Schema = z.array(userLiteSchema)

const assigneese80c6dSchema = z.union([
  defaultValuecb839fSchema,
  assignees0a93f0Schema,
  id045d22Schema,
])

const state2b0637Schema = z.union([stateLiteSchema, id045d22Schema])

const workItemExpandb2c21bSchema = z.object({
  id: idSchema.optional(),
  cycle: cyclec886e3Schema.optional(),
  module: module3602c7Schema.optional(),
  labels: labels13d966Schema.optional(),
  assignees: assigneese80c6dSchema.optional(),
  state: state2b0637Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  point: pointSchema.optional(),
  name: nameSchema.optional(),
  description: description2c8fe8Schema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  priority: priority7c079dSchema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  sequence_id: sequenceIdSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  completed_at: completedAtSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  is_draft: isDraftSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project30aa14Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  parent: parent6f1635Schema.optional(),
  estimate_point: estimatePoint1c3278Schema.optional(),
  type: typeSchema.optional(),
})

const issueDetailc259bfSchema = z.union([workItemExpandb2c21bSchema, id045d22Schema])

const project3f9722Schema = z.union([assetIdSchema, project51fea9Schema, id045d22Schema])

export const planeV2IntakeWorkItemsd605ceSchema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  duplicate_to_id: duplicateToIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  intake_id: intakeIdSchema.optional(),
  name: namef3ca52Schema.optional(),
  priority: priority0d388cSchema.optional(),
  snoozed_till: snoozedTill2b3739Schema.optional(),
  source: source0190a9Schema.optional(),
  source_email: sourceEmail6368deSchema.optional(),
  state_id: stateIdddfc84Schema.optional(),
  status: status9caf13Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  issue_detail: issueDetailc259bfSchema.optional(),
  inbox: inboxSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  extra: extraSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project3f9722Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  intake: intakeSchema.optional(),
  issue: issue4193e9Schema.optional(),
  duplicate_to: duplicateToSchema.optional(),
})

export const planeV2V2ListIntakeWorkItemsresultSchema = z.object({
  data: data4edeaeSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const module18ef2fSchema = z.union([moduleLiteab5dabSchema, id045d22Schema])

const labels850cfeSchema = z.array(labelefdebcSchema)

const labels78415eSchema = z.union([defaultValuecb839fSchema, labels850cfeSchema, id045d22Schema])

const assigneesf66ca0Schema = z.array(userLiteSchema)

const assignees8ac373Schema = z.union([
  defaultValuecb839fSchema,
  assigneesf66ca0Schema,
  id045d22Schema,
])

const statecf2ce4Schema = z.union([stateLiteSchema, id045d22Schema])

const workItemExpand03985bSchema = z.object({
  id: idSchema.optional(),
  cycle: cyclec886e3Schema.optional(),
  module: module18ef2fSchema.optional(),
  labels: labels78415eSchema.optional(),
  assignees: assignees8ac373Schema.optional(),
  state: statecf2ce4Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  point: pointSchema.optional(),
  name: nameSchema.optional(),
  description: description2c8fe8Schema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  priority: priority7c079dSchema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  sequence_id: sequenceIdSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  completed_at: completedAtSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  is_draft: isDraftSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project30aa14Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  parent: parent6f1635Schema.optional(),
  estimate_point: estimatePoint1c3278Schema.optional(),
  type: typeSchema.optional(),
})

const issueDetail3b057eSchema = z.union([workItemExpand03985bSchema, id045d22Schema])

const projectf7ead4Schema = z.union([assetIdSchema, project51fea9Schema, id045d22Schema])

export const intakeWorkItem108b7fSchema = z.object({
  id: idSchema.optional(),
  issue_detail: issueDetail3b057eSchema.optional(),
  inbox: inboxSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  status: status60a688Schema.optional(),
  snoozed_till: snoozedTillSchema.optional(),
  source: sourceSchema.optional(),
  source_email: sourceEmailSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  extra: extraSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: projectf7ead4Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  intake: intakeSchema.optional(),
  issue: issueSchema.optional(),
  duplicate_to: duplicateToSchema.optional(),
  name: assetIdSchema.optional(),
})

export const planeV2V2BulkInvitationsresultitemSchema = z.object({
  id: assetIdSchema.optional(),
  email: assetIdSchema.optional(),
  role: assetIdSchema.optional(),
  message: assetIdSchema.optional(),
  accepted: hasPages8e2bc3Schema.optional(),
  responded_at: cycle883343Schema.optional(),
  created_at: assetIdSchema.optional(),
  created_by_id: assetIdSchema.optional(),
})

const roleeae79dSchema = z.union([role28996dSchema, access644595Schema])

export const planeV2Invitationsd40deaSchema = z.object({
  accepted: acceptedSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  email: email0e37edSchema.optional(),
  id: id35193dSchema.optional(),
  message: message498389Schema.optional(),
  responded_at: respondedAtSchema.optional(),
  role: roleeae79dSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

export const planeV2V2ListInvitationsresultSchema = z.object({
  data: dataeb406fSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2BulkCreateLabelsresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteLabelsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateLabelsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

const id85f016Schema = z.union([id018dceSchema, assetIdSchema, id045d22Schema])

const description840a7fSchema = z.union([description96165cSchema, assetIdSchema, id045d22Schema])

const colorac64f7Schema = z.union([color880284Schema, assetIdSchema, id045d22Schema])

const sortOrder088338Schema = z.union([
  sortOrder56bb0aSchema,
  access644595Schema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

const createdAt1248feSchema = z.union([createdAta2b7a6Schema, assetIdSchema, id045d22Schema])

export const planeV2Labels8a1ae6Schema = z.object({
  id: id85f016Schema.optional(),
  name: name55c8feSchema.optional(),
  description: description840a7fSchema.optional(),
  color: colorac64f7Schema.optional(),
  sort_order: sortOrder088338Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1248feSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  project: project0bf380Schema.optional(),
  parent: parent6f1635Schema.optional(),
  deleted_by: id045d22Schema.optional(),
})

export const planeV2V2ListLabelsresultSchema = z.object({
  data: data42995aSchema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const rolee7ea40Schema = z.union([assetIdSchema, id045d22Schema, access644595Schema])

const member3b010bSchema = z.union([planeV2MemberSchema, assetIdSchema])

export const planeV2Members0326b2Schema = z.object({
  id: idddd330Schema.optional(),
  member_id: memberIdSchema.optional(),
  role: rolee7ea40Schema.optional(),
  member: member3b010bSchema.optional(),
})

export const planeV2V2GetProjectRoleDistributionresultSchema = z.object({
  roles: rolesSchema.optional(),
  total_distinct_members: access644595Schema.optional(),
  total_memberships: access644595Schema.optional(),
})

export const planeV2V2ListProjectMembersresultSchema = z.object({
  data: data6057dfSchema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceMembersresultSchema = z.object({
  data: data6057dfSchema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2BulkCreateMilestonesresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteMilestonesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateMilestonesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

const targetDate1d7269Schema = z.union([targetDate7b0ab1Schema, assetIdSchema, id045d22Schema])

export const planeV2Milestones9079dcSchema = z.object({
  archived_at: archivedAt31ccceSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  target_date: targetDate1d7269Schema.optional(),
  title: titlef754b4Schema.optional(),
  updated_at: updatedAtSchema.optional(),
})

export const planeV2V2ListMilestonesresultSchema = z.object({
  data: data7cf2d8Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ManageMilestoneWorkItemsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

export const planeV2V2BulkCreateModulesresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteModulesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateModulesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const moduleb27e64Schema = z.object({
  id: idSchema.optional(),
  total_issues: totalIssuesf869cfSchema.optional(),
  cancelled_issues: cancelledIssues7d6f65Schema.optional(),
  completed_issues: completedIssuesee96dfSchema.optional(),
  started_issues: startedIssuesd50eceSchema.optional(),
  unstarted_issues: unstartedIssues906046Schema.optional(),
  backlog_issues: backlogIssuesa57784Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  description_text: descriptionTextSchema.optional(),
  description_html: descriptionHtmlfa4901Schema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  status: statusSchema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  sort_order: sortOrderSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  lead: leadSchema.optional(),
  members: defaultValuecb839fSchema.optional(),
  deleted_by: id045d22Schema.optional(),
})

const id492c8cSchema = z.union([ida3c0e8Schema, assetIdSchema, id045d22Schema])

const description6b600dSchema = z.union([descriptionc3d3ebSchema, assetIdSchema, id045d22Schema])

const statuse662a9Schema = z.union([status2fb7baSchema, statusd21fa3Schema, id045d22Schema])

const sortOrder762384Schema = z.union([
  sortOrderedfb74Schema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

const createdAt4b6d37Schema = z.union([createdAteac330Schema, assetIdSchema, id045d22Schema])

const membersItemSchema = z.union([logoPropsb439a5Schema, assetIdSchema])

const membersc6e95cSchema = z.array(membersItemSchema)

export const planeV2Modules29b3c8Schema = z.object({
  id: id492c8cSchema.optional(),
  name: name55c8feSchema.optional(),
  description: description6b600dSchema.optional(),
  status: statuse662a9Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  lead_id: cycle883343Schema.optional(),
  member_ids: memberIdsSchema.optional(),
  sort_order: sortOrder762384Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt4b6d37Schema.optional(),
  created_by_id: createdByIdc85a02Schema.optional(),
  lead: ownedBy18e538Schema.optional(),
  members: membersc6e95cSchema.optional(),
  total_issues: totalIssuesf869cfSchema.optional(),
  cancelled_issues: cancelledIssues7d6f65Schema.optional(),
  completed_issues: completedIssuesee96dfSchema.optional(),
  started_issues: startedIssuesd50eceSchema.optional(),
  unstarted_issues: unstartedIssues906046Schema.optional(),
  backlog_issues: backlogIssuesa57784Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  description_text: descriptionTextSchema.optional(),
  description_html: descriptionHtmlfa4901Schema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  deleted_by: id045d22Schema.optional(),
})

const planeV2Modules6fa43fSchema = z.object({
  id: ida3c0e8Schema.optional(),
  name: name55c8feSchema.optional(),
  description: descriptionc3d3ebSchema.optional(),
  status: status2fb7baSchema.optional(),
  start_date: startDate4ec926Schema.optional(),
  target_date: targetDate13e2caSchema.optional(),
  lead_id: leadId22d0bfSchema.optional(),
  member_ids: memberIdsSchema.optional(),
  sort_order: sortOrderedfb74Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  archived_at: archivedAtdd21a8Schema.optional(),
  created_at: createdAteac330Schema.optional(),
  created_by_id: createdByIdc85a02Schema.optional(),
  lead: customFields9c1322Schema.optional(),
  members: pointsSchema.optional(),
})

const datac14c55Schema = z.array(planeV2Modules6fa43fSchema)

export const planeV2V2ListModulesresultSchema = z.object({
  data: datac14c55Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ManageModuleWorkItemsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

const module66a93eSchema = z.union([moduleLiteab5dabSchema, id045d22Schema])

const labels705fd1Schema = z.array(labelefdebcSchema)

const labelseb5497Schema = z.union([defaultValuecb839fSchema, labels705fd1Schema, id045d22Schema])

const assigneesa49035Schema = z.array(userLiteSchema)

const assigneesdb3997Schema = z.union([
  defaultValuecb839fSchema,
  assigneesa49035Schema,
  id045d22Schema,
])

const state7bbefaSchema = z.union([stateLiteSchema, id045d22Schema])

const workItemExpandfa1965Schema = z.object({
  id: idSchema.optional(),
  cycle: cyclec886e3Schema.optional(),
  module: module66a93eSchema.optional(),
  labels: labelseb5497Schema.optional(),
  assignees: assigneesdb3997Schema.optional(),
  state: state7bbefaSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  point: pointSchema.optional(),
  name: nameSchema.optional(),
  description: description2c8fe8Schema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  priority: priority7c079dSchema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  sequence_id: sequenceIdSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  completed_at: completedAtSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  is_draft: isDraftSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project30aa14Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  parent: parent6f1635Schema.optional(),
  estimate_point: estimatePoint1c3278Schema.optional(),
  type: typeSchema.optional(),
})

const issue1d1d84Schema = z.union([workItemExpandfa1965Schema, assetIdSchema])

export const moduleWorkItema652d3Schema = z.object({
  id: idSchema.optional(),
  sub_issues_count: subIssuesCount160d64Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  module: module83515fSchema.optional(),
  issue: issue1d1d84Schema.optional(),
  deleted_by: id045d22Schema.optional(),
})

export const planeV2Modules0ad45cSchema = z.object({
  id: ida3c0e8Schema.optional(),
  name: name55c8feSchema.optional(),
  description: descriptionc3d3ebSchema.optional(),
  status: status2fb7baSchema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  lead_id: cycle883343Schema.optional(),
  member_ids: memberIds840550Schema.optional(),
  sort_order: sortOrder6ecb16Schema.optional(),
  logo_props: logoPropse3e3c2Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  archived_at: archivedAtdd21a8Schema.optional(),
  created_at: createdAteac330Schema.optional(),
  created_by_id: createdByIdc85a02Schema.optional(),
  lead: customFields9c1322Schema.optional(),
  members: pointsSchema.optional(),
})

export const planeV2V2ListPermissionSchemesresultSchema = z.object({
  data: datafc3b83Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2GetProjectPermissionsresultSchema = z.object({
  permission_grants: defaultValuecb839fSchema.optional(),
  relation: assetIdSchema.optional(),
})

export const planeV2V2GetWorkspacePermissionsresultSchema = z.object({
  permission_grants: defaultValuecb839fSchema.optional(),
  relation: assetIdSchema.optional(),
})

export const planeV2V2ListProjectAutomationActivitiesresultSchema = z.object({
  data: data762d1cSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListProjectAutomationEdgesresultSchema = z.object({
  data: datab20d42Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListProjectAutomationNodesresultSchema = z.object({
  data: data7f9216Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListProjectAutomationsresultSchema = z.object({
  data: data6bc005Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ProjectRegenerateNodeWebhookSecretresultSchema = z.object({
  secret: assetIdSchema.optional(),
})

export const planeV2V2GetProjectFeaturesresult73a0efSchema = z.object({
  is_automated_cycle_enabled: hasPages8e2bc3Schema.optional(),
  is_epic_enabled: hasPages8e2bc3Schema.optional(),
  is_manually_start_end_cycles_enabled: hasPages8e2bc3Schema.optional(),
  is_milestone_enabled: hasPages8e2bc3Schema.optional(),
  is_parallel_cycles_enabled: hasPages8e2bc3Schema.optional(),
  is_project_updates_enabled: hasPages8e2bc3Schema.optional(),
  is_workflow_enabled: hasPages8e2bc3Schema.optional(),
  epics: epicsSchema.optional(),
  modules: modulesSchema.optional(),
  cycles: cyclesSchema.optional(),
  views: viewsSchema.optional(),
  pages: pagesSchema.optional(),
  intakes: intakesSchema.optional(),
  work_item_types: workItemTypesSchema.optional(),
  workflows: workflowsSchema.optional(),
  parallel_cycles: parallelCyclesSchema.optional(),
  project_updates: projectUpdatesSchema.optional(),
})

export const planeV2V2UpdateProjectFeaturesresult8240b7Schema = z.object({
  is_automated_cycle_enabled: hasPages8e2bc3Schema.optional(),
  is_epic_enabled: hasPages8e2bc3Schema.optional(),
  is_manually_start_end_cycles_enabled: hasPages8e2bc3Schema.optional(),
  is_milestone_enabled: hasPages8e2bc3Schema.optional(),
  is_parallel_cycles_enabled: hasPages8e2bc3Schema.optional(),
  is_project_updates_enabled: hasPages8e2bc3Schema.optional(),
  is_workflow_enabled: hasPages8e2bc3Schema.optional(),
  epics: epicsSchema.optional(),
  modules: modulesSchema.optional(),
  cycles: cyclesSchema.optional(),
  views: viewsSchema.optional(),
  pages: pagesSchema.optional(),
  intakes: intakesSchema.optional(),
  work_item_types: workItemTypesSchema.optional(),
  workflows: workflowsSchema.optional(),
  parallel_cycles: parallelCyclesSchema.optional(),
  project_updates: projectUpdatesSchema.optional(),
})

const collectionId827831Schema = z.union([collectionId856ec9Schema, id045d22Schema])

const parentIdf82ccaSchema = z.union([parentId280851Schema, id045d22Schema])

const planeV2ProjectPages210c03Schema = z.object({
  access: access97d6dbSchema.optional(),
  archived_at: archivedAt31ccceSchema.optional(),
  collection_id: collectionId827831Schema.optional(),
  color: color3938eeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  description_stripped: descriptionStrippedba3b79Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  is_locked: isLockedca86cfSchema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  name: namef3ca52Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  parent_id: parentIdf82ccaSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  owned_by: customFields9c1322Schema.optional(),
  parent: customFields9c1322Schema.optional(),
})

const access5296b7Schema = z.union([
  access97d6dbSchema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const collectionId6c8c33Schema = z.union([collectionId856ec9Schema, id045d22Schema, assetIdSchema])

const descriptionStripped03385fSchema = z.union([
  descriptionStrippedba3b79Schema,
  assetIdSchema,
  id045d22Schema,
])

const isLocked7fd353Schema = z.union([isLockedca86cfSchema, hasPages8e2bc3Schema, id045d22Schema])

const parentId66217aSchema = z.union([parentId280851Schema, id045d22Schema, assetIdSchema])

export const planeV2ProjectPages0df14eSchema = z.object({
  access: access5296b7Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  collection_id: collectionId6c8c33Schema.optional(),
  color: color3938eeSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  description_stripped: descriptionStripped03385fSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  is_locked: isLocked7fd353Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  name: name8b7867Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  parent_id: parentId66217aSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  owned_by: ownedBy18e538Schema.optional(),
  parent: customFields9c1322Schema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  description: descriptionb39dcdSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  anchor: anchorSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  projects: projectsSchema.optional(),
  page_collection_id: pageCollectionIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: cycle883343Schema.optional(),
  description_json: descriptionJson0b33adSchema.optional(),
})

export const planeV2ProjectPages6b917aSchema = z.object({
  access: access5296b7Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  collection_id: collectionId6c8c33Schema.optional(),
  color: color3938eeSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  description_stripped: descriptionStripped03385fSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  is_locked: isLocked7fd353Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  name: name8b7867Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  parent_id: parentId66217aSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  owned_by: ownedBy18e538Schema.optional(),
  parent: customFields9c1322Schema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  description: descriptionb39dcdSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  anchor: anchorSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  projects: projectsSchema.optional(),
  page_collection_id: pageCollectionIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: id045d22Schema.optional(),
  description_json: descriptionJson0b33adSchema.optional(),
})

const data546e02Schema = z.array(planeV2ProjectPages210c03Schema)

export const planeV2V2ListProjectPagesresultSchema = z.object({
  data: data546e02Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2ProjectViews116a1aSchema = z.object({
  access: access97d6dbSchema.optional(),
  archived_at: archivedAt31ccceSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  display_filters: displayFiltersSchema.optional(),
  display_properties: displayPropertiesSchema.optional(),
  filters: filtersSchema.optional(),
  id: id35193dSchema.optional(),
  is_locked: isLockedca86cfSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  pql_filters: pqlFiltersSchema.optional(),
  query: querySchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  owned_by: customFields9c1322Schema.optional(),
})

const data35e294Schema = z.array(planeV2ProjectViews116a1aSchema)

export const planeV2V2ListProjectViewsresultSchema = z.object({
  data: data35e294Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListProjectWorkItemTemplatesresultSchema = z.object({
  data: databaa83aSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2ProjectWorkItemTemplatesa6462fSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  id: id35193dSchema.optional(),
  is_published: isPublished013d88Schema.optional(),
  name: namef3ca52Schema.optional(),
  short_description: shortDescriptionSchema.optional(),
  short_id: shortIdSchema.optional(),
  slug: slugSchema.optional(),
  template_data: templateDataSchema.optional(),
  template_type: templateTypeSchema.optional(),
  archived_at: cycle883343Schema.optional(),
  assignee_ids: projectIds76d572Schema.optional(),
  custom_fields: logoPropsb439a5Schema.optional(),
  cycle_id: assetIdSchema.optional(),
  identifier: assetIdSchema.optional(),
  is_draft: hasPages8e2bc3Schema.optional(),
  label_ids: projectIds76d572Schema.optional(),
  module_ids: projectIds76d572Schema.optional(),
  parent_id: assetIdSchema.optional(),
  priority: assetIdSchema.optional(),
  project_id: assetIdSchema.optional(),
  sequence_id: assetIdSchema.optional(),
  start_date: assetIdSchema.optional(),
  state_id: assetIdSchema.optional(),
  target_date: assetIdSchema.optional(),
  type_id: assetIdSchema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: pointsSchema.optional(),
  parent: customFields9c1322Schema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
})

export const planeV2V2BulkCreateProjectsresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateProjectsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

const coverImage7b4bb5Schema = z.union([coverImage1c99d0Schema, id045d22Schema])

const coverImageUrldc35eeSchema = z.union([coverImageUrl4a1253Schema, id045d22Schema])

const defaultAssigneeId053282Schema = z.union([defaultAssigneeIdSchema, id045d22Schema])

const defaultStateIdd87cd6Schema = z.union([defaultStateIdSchema, id045d22Schema])

const emojic5f22cSchema = z.union([emoji40b5b7Schema, id045d22Schema])

const estimateId113377Schema = z.union([estimateIdSchema, id045d22Schema])

const projectLeadIdd4dea5Schema = z.union([projectLeadIdSchema, id045d22Schema])

const startDate33401bSchema = z.union([startDate43e866Schema, id045d22Schema])

const targetDate3e40fbSchema = z.union([targetDate7b0ab1Schema, id045d22Schema])

const planeV2Projects6a3405Schema = z.object({
  archive_in: archiveIn875827Schema.optional(),
  archived_at: archivedAt31ccceSchema.optional(),
  close_in: closeIn4103eeSchema.optional(),
  cover_image: coverImage7b4bb5Schema.optional(),
  cover_image_url: coverImageUrldc35eeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  cycle_view: cycleView2b2a92Schema.optional(),
  default_assignee_id: defaultAssigneeId053282Schema.optional(),
  default_state_id: defaultStateIdd87cd6Schema.optional(),
  description: description36d05fSchema.optional(),
  emoji: emojic5f22cSchema.optional(),
  estimate_id: estimateId113377Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  guest_view_all_features: guestViewAllFeatures786ecfSchema.optional(),
  icon_prop: iconProp8d9de6Schema.optional(),
  id: id35193dSchema.optional(),
  identifier: identifier74e88fSchema.optional(),
  intake_view: intakeViewadf501Schema.optional(),
  is_issue_type_enabled: isIssueTypeEnabled0467a8Schema.optional(),
  is_time_tracking_enabled: isTimeTrackingEnabledc98808Schema.optional(),
  issue_views_view: issueViewsView9a6da4Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  module_view: moduleViewff7a9cSchema.optional(),
  name: namef3ca52Schema.optional(),
  network: networkab7e29Schema.optional(),
  page_view: pageView884451Schema.optional(),
  priority: priority0d388cSchema.optional(),
  project_lead_id: projectLeadIdd4dea5Schema.optional(),
  start_date: startDate33401bSchema.optional(),
  state_id: stateIdddfc84Schema.optional(),
  target_date: targetDate3e40fbSchema.optional(),
  timezone: timezone852348Schema.optional(),
  default_assignee: customFields9c1322Schema.optional(),
  project_lead: customFields9c1322Schema.optional(),
})

const totalMembers8c880eSchema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const totalCyclesb4c52cSchema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const totalModules622341Schema = z.union([
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const memberRole94a311Schema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const descriptionHtml6297f0Schema = z.union([logoProps44136fSchema, id045d22Schema, assetIdSchema])

const networka4c6f8Schema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const archiveIna22d77Schema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const closeIn86ac39Schema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

export const project26b734Schema = z.object({
  id: idSchema.optional(),
  total_members: totalMembers8c880eSchema.optional(),
  total_cycles: totalCyclesb4c52cSchema.optional(),
  total_modules: totalModules622341Schema.optional(),
  is_member: isMemberSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  member_role: memberRole94a311Schema.optional(),
  is_deployed: isDeployedSchema.optional(),
  cover_image_url: coverImageUrlSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  description_text: descriptionTextSchema.optional(),
  description_html: descriptionHtml6297f0Schema.optional(),
  network: networka4c6f8Schema.optional(),
  identifier: identifierSchema.optional(),
  emoji: emojiSchema.optional(),
  icon_prop: iconPropSchema.optional(),
  module_view: moduleViewSchema.optional(),
  cycle_view: cycleViewSchema.optional(),
  issue_views_view: issueViewsViewSchema.optional(),
  page_view: pageViewSchema.optional(),
  intake_view: intakeViewSchema.optional(),
  is_time_tracking_enabled: isTimeTrackingEnabledSchema.optional(),
  is_issue_type_enabled: isIssueTypeEnabledSchema.optional(),
  guest_view_all_features: guestViewAllFeaturesSchema.optional(),
  cover_image: coverImageSchema.optional(),
  archive_in: archiveIna22d77Schema.optional(),
  close_in: closeIn86ac39Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  archived_at: archivedAtSchema.optional(),
  timezone: timezone7677ddSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  default_assignee: defaultAssignee13325eSchema.optional(),
  project_lead: projectLeadaf8c35Schema.optional(),
  cover_image_asset: coverImageAssetSchema.optional(),
  estimate: estimateSchema.optional(),
  default_state: defaultStateSchema.optional(),
  deleted_by: id045d22Schema.optional(),
  priority: assetIdSchema.optional(),
  start_date: id045d22Schema.optional(),
  target_date: id045d22Schema.optional(),
  is_voting_enabled: hasPages8e2bc3Schema.optional(),
  auto_reminder_days: sortOrderdde3e5Schema.optional(),
  state: assetIdSchema.optional(),
})

const archiveIn7fc1e5Schema = z.union([
  archiveIn875827Schema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const closeIn282462Schema = z.union([
  closeIn4103eeSchema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const coverImage5a836dSchema = z.union([coverImage1c99d0Schema, id045d22Schema, assetIdSchema])

const coverImageUrl859208Schema = z.union([
  coverImageUrl4a1253Schema,
  id045d22Schema,
  assetIdSchema,
])

const cycleView4330edSchema = z.union([cycleView2b2a92Schema, hasPages8e2bc3Schema, id045d22Schema])

const emojifc2580Schema = z.union([emoji40b5b7Schema, id045d22Schema, assetIdSchema])

const guestViewAllFeaturesb22645Schema = z.union([
  guestViewAllFeatures786ecfSchema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const iconPropf95060Schema = z.union([iconProp7d18beSchema, id045d22Schema, logoProps44136fSchema])

const intakeViewb5d6f1Schema = z.union([
  intakeViewadf501Schema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const isIssueTypeEnabled2cc661Schema = z.union([
  isIssueTypeEnabled0467a8Schema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const isTimeTrackingEnabledb95246Schema = z.union([
  isTimeTrackingEnabledc98808Schema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const issueViewsView899c2aSchema = z.union([
  issueViewsView9a6da4Schema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const moduleView385b9aSchema = z.union([
  moduleViewff7a9cSchema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const network1a0adbSchema = z.union([
  networkab7e29Schema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const pageViewd0cd10Schema = z.union([pageView884451Schema, hasPages8e2bc3Schema, id045d22Schema])

const timezone35d490Schema = z.union([timezone852348Schema, timezone467abfSchema, id045d22Schema])

export const planeV2Projects80208cSchema = z.object({
  archive_in: archiveIn7fc1e5Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  close_in: closeIn282462Schema.optional(),
  cover_image: coverImage5a836dSchema.optional(),
  cover_image_url: coverImageUrl859208Schema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  cycle_view: cycleView4330edSchema.optional(),
  default_assignee_id: defaultAssigneeId053282Schema.optional(),
  default_state_id: defaultStateIdd87cd6Schema.optional(),
  description: description16907bSchema.optional(),
  emoji: emojifc2580Schema.optional(),
  estimate_id: estimateId113377Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  guest_view_all_features: guestViewAllFeaturesb22645Schema.optional(),
  icon_prop: iconPropf95060Schema.optional(),
  id: id835e8aSchema.optional(),
  identifier: identifier74e88fSchema.optional(),
  intake_view: intakeViewb5d6f1Schema.optional(),
  is_issue_type_enabled: isIssueTypeEnabled2cc661Schema.optional(),
  is_time_tracking_enabled: isTimeTrackingEnabledb95246Schema.optional(),
  issue_views_view: issueViewsView899c2aSchema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  module_view: moduleView385b9aSchema.optional(),
  name: namef3ca52Schema.optional(),
  network: network1a0adbSchema.optional(),
  page_view: pageViewd0cd10Schema.optional(),
  priority: priority0d388cSchema.optional(),
  project_lead_id: projectLeadIdd4dea5Schema.optional(),
  start_date: startDate33401bSchema.optional(),
  state_id: stateIdddfc84Schema.optional(),
  target_date: targetDate3e40fbSchema.optional(),
  timezone: timezone35d490Schema.optional(),
  default_assignee: ownedBy18e538Schema.optional(),
  project_lead: ownedBy18e538Schema.optional(),
  total_members: totalMembers8c880eSchema.optional(),
  total_cycles: totalCyclesb4c52cSchema.optional(),
  total_modules: totalModules622341Schema.optional(),
  is_member: isMemberSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  member_role: memberRole94a311Schema.optional(),
  is_deployed: isDeployedSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  description_text: descriptionTextSchema.optional(),
  description_html: descriptionHtml6297f0Schema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  cover_image_asset: coverImageAssetSchema.optional(),
  estimate: estimateSchema.optional(),
  default_state: defaultStateSchema.optional(),
  deleted_by: id045d22Schema.optional(),
  is_voting_enabled: hasPages8e2bc3Schema.optional(),
  auto_reminder_days: sortOrderdde3e5Schema.optional(),
  state: assetIdSchema.optional(),
})

const counts311075Schema = z.union([planeV2CountsSchema, countsSchema])

export const planeV2V2GetProjectSummaryresult4f96bdSchema = z.object({
  counts: counts311075Schema.optional(),
  id: assetIdSchema.optional(),
  identifier: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
})

const datad9f118Schema = z.array(planeV2Projects6a3405Schema)

export const planeV2V2ListProjectsresultSchema = z.object({
  data: datad9f118Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2Projects30f866Schema = z.object({
  archive_in: archiveIn875827Schema.optional(),
  archived_at: archivedAt31ccceSchema.optional(),
  close_in: closeIn4103eeSchema.optional(),
  cover_image: coverImage1c99d0Schema.optional(),
  cover_image_url: coverImageUrl4a1253Schema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  cycle_view: cycleView2b2a92Schema.optional(),
  default_assignee_id: defaultAssigneeIdSchema.optional(),
  default_state_id: defaultStateIdSchema.optional(),
  description: description36d05fSchema.optional(),
  emoji: emoji40b5b7Schema.optional(),
  estimate_id: estimateIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  guest_view_all_features: guestViewAllFeatures786ecfSchema.optional(),
  icon_prop: iconProp8d9de6Schema.optional(),
  id: id35193dSchema.optional(),
  identifier: identifier74e88fSchema.optional(),
  intake_view: intakeViewadf501Schema.optional(),
  is_issue_type_enabled: isIssueTypeEnabled0467a8Schema.optional(),
  is_time_tracking_enabled: isTimeTrackingEnabledc98808Schema.optional(),
  issue_views_view: issueViewsView9a6da4Schema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  module_view: moduleViewff7a9cSchema.optional(),
  name: namef3ca52Schema.optional(),
  network: networkab7e29Schema.optional(),
  page_view: pageView884451Schema.optional(),
  priority: priority0d388cSchema.optional(),
  project_lead_id: projectLeadIdSchema.optional(),
  start_date: startDate43e866Schema.optional(),
  state_id: stateIdddfc84Schema.optional(),
  target_date: targetDate7b0ab1Schema.optional(),
  timezone: timezone852348Schema.optional(),
  default_assignee: customFields9c1322Schema.optional(),
  project_lead: customFields9c1322Schema.optional(),
})

export const releaseComment65d33fSchema = z.object({
  id: idSchema.optional(),
  comment: commentfbe0c5Schema.optional(),
  is_hidden: isHiddenSchema.optional(),
  is_resolved: isResolvedSchema.optional(),
  parent: parent6f1635Schema.optional(),
  edited_at: editedAtSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  release: release5c8689Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
})

const editedAt365e47Schema = z.union([editedAt3206dfSchema, assetIdSchema, id045d22Schema])

const isHiddenf40267Schema = z.union([isHiddene48c42Schema, hasPages8e2bc3Schema, id045d22Schema])

const isResolved168438Schema = z.union([
  isResolved3c3c67Schema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

export const planeV2ReleaseComments9a1f27Schema = z.object({
  comment_html: commentHtmlf4a8cbSchema.optional(),
  comment_id: commentIdSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  edited_at: editedAt365e47Schema.optional(),
  id: id835e8aSchema.optional(),
  is_hidden: isHiddenf40267Schema.optional(),
  is_resolved: isResolved168438Schema.optional(),
  parent_id: parentId280851Schema.optional(),
  release_id: releaseIdSchema.optional(),
  comment: commentfbe0c5Schema.optional(),
  parent: parent6f1635Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  release: release5c8689Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
})

export const planeV2V2ListReleaseCommentsresultSchema = z.object({
  data: dataf71c33Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const releaseLabel1b6179Schema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  project: project24481aSchema.optional(),
})

const sortOrder818ca7Schema = z.union([
  sortOrder5bf4dfSchema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

export const planeV2ReleaseLabels0df496Schema = z.object({
  color: color7410a0Schema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id835e8aSchema.optional(),
  name: name8b7867Schema.optional(),
  sort_order: sortOrder818ca7Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  project: project24481aSchema.optional(),
})

export const planeV2V2ListReleaseLabelsresultSchema = z.object({
  data: data1c20e4Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const releaseLink8c1f1bSchema = z.object({
  id: idSchema.optional(),
  title: titleSchema.optional(),
  url: urlb58d03Schema.optional(),
  metadata: metadataSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  release: release5c8689Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
})

const metadataf0a51fSchema = z.union([metadatabe6a14Schema, id045d22Schema, logoProps44136fSchema])

const titled12a0dSchema = z.union([titlef754b4Schema, assetIdSchema, id045d22Schema])

const url1b5397Schema = z.union([urlc17248Schema, assetIdSchema, id045d22Schema])

export const planeV2ReleaseLinks259dd6Schema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id835e8aSchema.optional(),
  metadata: metadataf0a51fSchema.optional(),
  release_id: releaseIdSchema.optional(),
  title: titled12a0dSchema.optional(),
  url: url1b5397Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  release: release5c8689Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
})

export const planeV2V2ListReleaseLinksresultSchema = z.object({
  data: data1f7f03Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const releaseTag5b2b5eSchema = z.object({
  id: idSchema.optional(),
  version: versione55854Schema.optional(),
  description: descriptionSchema.optional(),
  commit_hash: commitHashSchema.optional(),
  git_tag: gitTagSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  deleted_at: cycle883343Schema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
  project: project24481aSchema.optional(),
})

const commitHashbd32cdSchema = z.union([commitHash584d19Schema, assetIdSchema, id045d22Schema])

const gitTagf6208dSchema = z.union([gitTag6cd832Schema, assetIdSchema, id045d22Schema])

const version3910b0Schema = z.union([version2a0489Schema, assetIdSchema, id045d22Schema])

export const planeV2ReleaseTagsb985e4Schema = z.object({
  commit_hash: commitHashbd32cdSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description16907bSchema.optional(),
  git_tag: gitTagf6208dSchema.optional(),
  id: id835e8aSchema.optional(),
  version: version3910b0Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  deleted_at: cycle883343Schema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
  project: project24481aSchema.optional(),
})

export const planeV2V2ListReleaseTagsresultSchema = z.object({
  data: data202b62Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const planeV2Releases20788bSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  description_id: descriptionIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_latest: isLatest2376d0Schema.optional(),
  is_prerelease: isPrerelease0a132bSchema.optional(),
  label_ids: labelIds7d9fa4Schema.optional(),
  lead_id: leadIdSchema.optional(),
  name: namef3ca52Schema.optional(),
  release_date: releaseDate372b24Schema.optional(),
  status: status56c139Schema.optional(),
  tag_id: tagIdSchema.optional(),
  target_date: targetDate7b0ab1Schema.optional(),
  lead: customFields9c1322Schema.optional(),
  tag: customFields9c1322Schema.optional(),
})

export const release55ee53Schema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  description: description2c8fe8Schema.optional(),
  status: status4b8517Schema.optional(),
  target_date: targetDateSchema.optional(),
  release_date: releaseDateSchema.optional(),
  lead: leadSchema.optional(),
  tag: tagSchema.optional(),
  is_latest: isLatestSchema.optional(),
  is_prerelease: isPrereleaseSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  start_date: startDateSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  deleted_at: cycle883343Schema.optional(),
  project: project24481aSchema.optional(),
})

const isLatest856672Schema = z.union([isLatest2376d0Schema, hasPages8e2bc3Schema, id045d22Schema])

const isPrereleased11216Schema = z.union([
  isPrerelease0a132bSchema,
  hasPages8e2bc3Schema,
  id045d22Schema,
])

const releaseDate82e1c5Schema = z.union([releaseDate372b24Schema, assetIdSchema, id045d22Schema])

const statusaf139bSchema = z.union([status56c139Schema, assetIdSchema, id045d22Schema])

export const planeV2Releases2f1360Schema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  description_id: descriptionIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  is_latest: isLatest856672Schema.optional(),
  is_prerelease: isPrereleased11216Schema.optional(),
  label_ids: labelIds7d9fa4Schema.optional(),
  lead_id: leadIdSchema.optional(),
  name: name8b7867Schema.optional(),
  release_date: releaseDate82e1c5Schema.optional(),
  status: statusaf139bSchema.optional(),
  tag_id: tagIdSchema.optional(),
  target_date: targetDate1d7269Schema.optional(),
  lead: ownedBy18e538Schema.optional(),
  tag: ownedBy18e538Schema.optional(),
  description: description2c8fe8Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  start_date: startDateSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  deleted_at: cycle883343Schema.optional(),
  project: project24481aSchema.optional(),
})

export const planeV2Releases6e73e7Schema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  description_id: descriptionIdSchema.optional(),
  external_id: externalIdba2ed6Schema.optional(),
  external_source: externalSourcedf9b11Schema.optional(),
  id: id835e8aSchema.optional(),
  is_latest: isLatest2376d0Schema.optional(),
  is_prerelease: isPrerelease0a132bSchema.optional(),
  label_ids: labelIds802308Schema.optional(),
  lead_id: leadIdSchema.optional(),
  name: namef3ca52Schema.optional(),
  release_date: releaseDate372b24Schema.optional(),
  status: status56c139Schema.optional(),
  tag_id: tagIdSchema.optional(),
  target_date: targetDate7b0ab1Schema.optional(),
  changelog_id: assetIdSchema.optional(),
  description_json: id045d22Schema.optional(),
  release_id: assetIdSchema.optional(),
  changelog: changelogSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  release: release5c8689Schema.optional(),
  deleted_at: cycle883343Schema.optional(),
})

const data0ff98bSchema = z.array(planeV2Releases20788bSchema)

export const planeV2V2ListReleasesresultSchema = z.object({
  data: data0ff98bSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ManageReleaseLabelsresultSchema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
})

export const planeV2V2ManageReleaseWorkItemsresult0e13c5Schema = z.object({
  added: defaultValuecb839fSchema.optional(),
  removed: defaultValuecb839fSchema.optional(),
  message: assetIdSchema.optional(),
})

export const planeV2V2ListRolesresultSchema = z.object({
  data: datac7747aSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2BulkCreateStatesresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteStatesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateStatesresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const state4b88aeSchema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  color: colorbba70bSchema.optional(),
  sequence: sequenceSchema.optional(),
  group: groupSchema.optional(),
  is_triage: isTriageSchema.optional(),
  default: defaultSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  slug: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
})

const id0104b0Schema = z.union([id6acb64Schema, assetIdSchema, id045d22Schema])

const descriptioneb47e6Schema = z.union([description5b24b0Schema, assetIdSchema, id045d22Schema])

const group37f580Schema = z.union([groupa33045Schema, groupb0d31eSchema, id045d22Schema])

const sequencebe4b18Schema = z.union([
  sequenced0470fSchema,
  access644595Schema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

const isTriage51d413Schema = z.union([isTriage72bb4aSchema, hasPages8e2bc3Schema, id045d22Schema])

const createdAt1f9096Schema = z.union([createdAtceca3cSchema, assetIdSchema, id045d22Schema])

export const planeV2States28ce24Schema = z.object({
  id: id0104b0Schema.optional(),
  name: name55c8feSchema.optional(),
  description: descriptioneb47e6Schema.optional(),
  color: color742473Schema.optional(),
  group: group37f580Schema.optional(),
  sequence: sequencebe4b18Schema.optional(),
  is_default: isDefault91f18aSchema.optional(),
  is_triage: isTriage51d413Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1f9096Schema.optional(),
  created_by_id: createdById3bca72Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  default: defaultSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  slug: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
})

export const planeV2V2ListStatesresultSchema = z.object({
  data: data283bbfSchema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const backgroundColor3b6724Schema = z.union([
  backgroundColor97fcabSchema,
  assetIdSchema,
  id045d22Schema,
])

const logoProps7df626Schema = z.union([logoPropsb599b9Schema, id045d22Schema, settings43c814Schema])

export const planeV2Stickiesf0ced7Schema = z.object({
  background_color: backgroundColor3b6724Schema.optional(),
  color: color7410a0Schema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  description_stripped: descriptionStripped03385fSchema.optional(),
  id: id35193dSchema.optional(),
  logo_props: logoProps7df626Schema.optional(),
  name: name8b7867Schema.optional(),
  owner_id: ownerIdSchema.optional(),
  sort_order: sortOrder9643a4Schema.optional(),
  description: descriptionb39dcdSchema.optional(),
  description_binary: descriptionBinary7500edSchema.optional(),
  workspace: workspace259123Schema.optional(),
  owner: ownerSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: cycle883343Schema.optional(),
  created_by: cycle883343Schema.optional(),
  updated_by: cycle883343Schema.optional(),
})

export const planeV2V2ListStickiesresultSchema = z.object({
  data: datadec467Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const sticky12cfaeSchema = z.object({
  id: ide04262Schema.optional(),
  name: nameSchema.optional(),
  description: descriptionb39dcdSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinary7500edSchema.optional(),
  logo_props: logoProps235527Schema.optional(),
  color: colorSchema.optional(),
  background_color: backgroundColorSchema.optional(),
  workspace: workspace259123Schema.optional(),
  owner: ownerSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: cycle883343Schema.optional(),
  created_by: cycle883343Schema.optional(),
  updated_by: cycle883343Schema.optional(),
  grouped_by: assetIdSchema.optional(),
  sub_grouped_by: assetIdSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: assetIdSchema.optional(),
  prev_cursor: assetIdSchema.optional(),
  next_page_results: hasPages8e2bc3Schema.optional(),
  prev_page_results: hasPages8e2bc3Schema.optional(),
  count: access644595Schema.optional(),
  total_pages: access644595Schema.optional(),
  total_results: access644595Schema.optional(),
  extra_stats: extraStatsSchema.optional(),
  results: results5fa64dSchema.optional(),
})

const planeV2Teamspaces10afbdSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  id: id35193dSchema.optional(),
  lead_id: leadIdSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  member_ids: memberIds139e2aSchema.optional(),
  name: namef3ca52Schema.optional(),
  project_ids: projectIdsa92388Schema.optional(),
  lead: customFields9c1322Schema.optional(),
})

export const teamspaced3d01eSchema = z.object({
  id: ide04262Schema.optional(),
  name: nameeb0f45Schema.optional(),
  description_json: descriptionJsonSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinary7500edSchema.optional(),
  logo_props: logoProps30a00bSchema.optional(),
  lead: leadSchema.optional(),
  workspace: workspace259123Schema.optional(),
  created_at: createdAtff28e1Schema.optional(),
  updated_at: updatedAt43e222Schema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: updatedBye10d2eSchema.optional(),
})

const logoProps00c670Schema = z.union([
  logoPropsb599b9Schema,
  id045d22Schema,
  logoProps8ef9c5Schema,
])

export const planeV2Teamspaces2e5b2fSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  id: id35193dSchema.optional(),
  lead_id: leadIdSchema.optional(),
  logo_props: logoProps00c670Schema.optional(),
  member_ids: memberIds139e2aSchema.optional(),
  name: namef3ca52Schema.optional(),
  project_ids: projectIdsa92388Schema.optional(),
  lead: ownedBy18e538Schema.optional(),
  description_json: descriptionJsonSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinary7500edSchema.optional(),
  workspace: workspace259123Schema.optional(),
  updated_at: updatedAt43e222Schema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: updatedBye10d2eSchema.optional(),
})

const data261570Schema = z.array(planeV2Teamspaces10afbdSchema)

export const planeV2V2ListTeamspacesresultSchema = z.object({
  data: data261570Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2Teamspaces5a249dSchema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  id: id35193dSchema.optional(),
  lead_id: leadIdSchema.optional(),
  logo_props: logoProps00c670Schema.optional(),
  member_ids: memberIds139e2aSchema.optional(),
  name: namef3ca52Schema.optional(),
  project_ids: projectIdsa92388Schema.optional(),
  lead: ownedBy18e538Schema.optional(),
  description_json: descriptionJsonSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinary7500edSchema.optional(),
  workspace: workspace259123Schema.optional(),
  updated_at: updatedAt43e222Schema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
})

const fields361c0eSchema = z.object({
  'Content-Type': assetIdSchema.optional(),
  key: assetIdSchema.optional(),
  'x-amz-algorithm': assetIdSchema.optional(),
  'x-amz-credential': assetIdSchema.optional(),
  'x-amz-date': assetIdSchema.optional(),
  policy: assetIdSchema.optional(),
  'x-amz-signature': assetIdSchema.optional(),
})

const uploadData27f4dfSchema = z.object({
  url: assetIdSchema.optional(),
  fields: fields361c0eSchema.optional(),
})

export const planeV2UserAssets89dd1aSchema = z.object({
  asset_url: assetUrlSchema.optional(),
  attributes: attributes2ff54bSchema.optional(),
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  entity_type: entityType7582d6Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedb45807Schema.optional(),
  name: namef3ca52Schema.optional(),
  size: size422d69Schema.optional(),
  user_id: userIdSchema.optional(),
  asset_id: assetIdSchema.optional(),
  upload_data: uploadData27f4dfSchema.optional(),
})

export const planeV2V2ListUserAssetsresultSchema = z.object({
  data: data02bf8dSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWebhookLogsresultSchema = z.object({
  data: data5085a5Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWebhooksresultSchema = z.object({
  data: data956b74Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2RegenerateWebhookSecretresultSchema = z.object({
  content_type: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
  created_by_id: assetIdSchema.optional(),
  id: assetIdSchema.optional(),
  is_active: hasPages8e2bc3Schema.optional(),
  name: assetIdSchema.optional(),
  scopes: defaultValuecb839fSchema.optional(),
  secret_key: assetIdSchema.optional(),
  url: assetIdSchema.optional(),
  version: assetIdSchema.optional(),
})

const planeV2WorkItemActivitiesba8771Schema = z.object({
  actor_id: actorIdSchema.optional(),
  comment: comment714233Schema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  duration: durationcec84dSchema.optional(),
  epoch: epochf145abSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  field: field956f5bSchema.optional(),
  id: id35193dSchema.optional(),
  issue_comment_id: issueCommentIdSchema.optional(),
  new_identifier_id: newIdentifierIdSchema.optional(),
  new_value: newValue883a22Schema.optional(),
  old_identifier_id: oldIdentifierIdSchema.optional(),
  old_value: oldValue91bc69Schema.optional(),
  verb: verbc42427Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  actor: customFields9c1322Schema.optional(),
})

const actorf9564cSchema = z.union([assetIdSchema, id045d22Schema])

const comment959498Schema = z.union([comment714233Schema, assetIdSchema, id045d22Schema])

const epoch695e96Schema = z.union([epoch0ecdbdSchema, access644595Schema, id045d22Schema])

const fieldd6d073Schema = z.union([field956f5bSchema, assetIdSchema, id045d22Schema])

const newValue714ce9Schema = z.union([newValue883a22Schema, assetIdSchema, id045d22Schema])

const oldValuec23d31Schema = z.union([oldValue91bc69Schema, assetIdSchema, id045d22Schema])

const verb39c6b6Schema = z.union([verbc42427Schema, assetIdSchema, id045d22Schema])

export const planeV2WorkItemActivities7d9718Schema = z.object({
  actor_id: actorIdSchema.optional(),
  comment: comment959498Schema.optional(),
  created_at: createdAt88654eSchema.optional(),
  duration: durationcec84dSchema.optional(),
  epoch: epoch695e96Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  field: fieldd6d073Schema.optional(),
  id: id835e8aSchema.optional(),
  issue_comment_id: issueCommentIdSchema.optional(),
  new_identifier_id: newIdentifierIdSchema.optional(),
  new_value: newValue714ce9Schema.optional(),
  old_identifier_id: oldIdentifierIdSchema.optional(),
  old_value: oldValuec23d31Schema.optional(),
  verb: verb39c6b6Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  actor: ownedBy18e538Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  attachments: attachmentsSchema.optional(),
  old_identifier: oldIdentifierSchema.optional(),
  new_identifier: newIdentifierSchema.optional(),
  project: project4c8ec3Schema.optional(),
  workspace: workspace259123Schema.optional(),
  issue: issueSchema.optional(),
  issue_comment: issueCommentSchema.optional(),
  grouped_by: assetIdSchema.optional(),
  sub_grouped_by: assetIdSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: assetIdSchema.optional(),
  prev_cursor: assetIdSchema.optional(),
  next_page_results: hasPages8e2bc3Schema.optional(),
  prev_page_results: hasPages8e2bc3Schema.optional(),
  count: access644595Schema.optional(),
  total_pages: access644595Schema.optional(),
  total_results: access644595Schema.optional(),
  extra_stats: extraStatsSchema.optional(),
  results: results803362Schema.optional(),
})

const data8ff7b7Schema = z.array(planeV2WorkItemActivitiesba8771Schema)

export const planeV2V2ListActivitiesresultSchema = z.object({
  data: data8ff7b7Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemActivity7fff5bSchema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  verb: verbSchema.optional(),
  field: fieldSchema.optional(),
  old_value: oldValueSchema.optional(),
  new_value: newValueSchema.optional(),
  comment: commentSchema.optional(),
  attachments: attachmentsSchema.optional(),
  old_identifier: oldIdentifierSchema.optional(),
  new_identifier: newIdentifierSchema.optional(),
  epoch: epochSchema.optional(),
  project: project4c8ec3Schema.optional(),
  workspace: workspace259123Schema.optional(),
  issue: issueSchema.optional(),
  issue_comment: issueCommentSchema.optional(),
  actor: actorf9564cSchema.optional(),
  name: assetIdSchema.optional(),
})

const userb09253Schema = z.union([assetIdSchema, id045d22Schema])

const workItemAttachment6ef93dSchema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  attributes: attributes0d5d79Schema.optional(),
  asset: assetSchema.optional(),
  entity_type: entityTypeSchema.optional(),
  entity_identifier: entityIdentifierSchema.optional(),
  is_deleted: isDeletedSchema.optional(),
  is_archived: isArchivedSchema.optional(),
  external_id: externalIdSchema.optional(),
  external_source: externalSourceSchema.optional(),
  size: sizeSchema.optional(),
  is_uploaded: isUploadedSchema.optional(),
  storage_metadata: storageMetadataSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  user: userb09253Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  draft_issue: draftIssueSchema.optional(),
  project: project0bf380Schema.optional(),
  issue: issueSchema.optional(),
  comment: commentSchema.optional(),
  page: pageSchema.optional(),
})

export const planeV2WorkItemAttachmentse3fe99Schema = z.object({
  asset_url: assetUrlSchema.optional(),
  attributes: attributes2ff54bSchema.optional(),
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedb45807Schema.optional(),
  name: namef3ca52Schema.optional(),
  size: size422d69Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  asset_id: assetIdSchema.optional(),
  attachment: workItemAttachment6ef93dSchema.optional(),
  upload_data: uploadData016c9cSchema.optional(),
  detail: detailSchema.optional(),
})

export const planeV2V2ListAttachmentsresultSchema = z.object({
  data: datae25e41Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemAttachmentc365e0Schema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  attributes: attributes0d5d79Schema.optional(),
  asset: assetSchema.optional(),
  entity_type: entityTypeSchema.optional(),
  entity_identifier: entityIdentifierSchema.optional(),
  is_deleted: isDeletedSchema.optional(),
  is_archived: isArchivedSchema.optional(),
  external_id: externalIdSchema.optional(),
  external_source: externalSourceSchema.optional(),
  size: sizeSchema.optional(),
  is_uploaded: isUploadedSchema.optional(),
  storage_metadata: storageMetadataSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  user: userb09253Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  draft_issue: draftIssueSchema.optional(),
  project: project0bf380Schema.optional(),
  issue: issueSchema.optional(),
  comment: commentSchema.optional(),
  page: pageSchema.optional(),
  name: assetIdSchema.optional(),
  asset_url: assetIdSchema.optional(),
})

export const planeV2V2BulkCreateCommentsresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteCommentsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateCommentsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2WorkItemComments8b4ed9Schema = z.object({
  id: idddc529Schema.optional(),
  work_item_id: workItemIda2fc32Schema.optional(),
  comment_html: commentHtml2d6efcSchema.optional(),
  comment_stripped: commentStripped14f41eSchema.optional(),
  access: accessc9a263Schema.optional(),
  actor_id: assetIdSchema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  edited_at: cycle883343Schema.optional(),
  created_at: createdAt899c85Schema.optional(),
  created_by_id: assetIdSchema.optional(),
  actor: customFields9c1322Schema.optional(),
})

const id1dc427Schema = z.union([idddc529Schema, assetIdSchema, id045d22Schema])

const commentHtml4e04baSchema = z.union([commentHtml2d6efcSchema, assetIdSchema, id045d22Schema])

const commentStrippede29b44Schema = z.union([
  commentStripped14f41eSchema,
  assetIdSchema,
  id045d22Schema,
])

const access8cd280Schema = z.union([accessc9a263Schema, access4ffefdSchema, id045d22Schema])

const createdAte53020Schema = z.union([createdAt899c85Schema, assetIdSchema, id045d22Schema])

export const planeV2WorkItemComments0c5466Schema = z.object({
  id: id1dc427Schema.optional(),
  work_item_id: workItemIda2fc32Schema.optional(),
  comment_html: commentHtml4e04baSchema.optional(),
  comment_stripped: commentStrippede29b44Schema.optional(),
  access: access8cd280Schema.optional(),
  actor_id: assetIdSchema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  edited_at: cycle883343Schema.optional(),
  created_at: createdAte53020Schema.optional(),
  created_by_id: assetIdSchema.optional(),
  actor: ownedBy18e538Schema.optional(),
  is_member: isMemberSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  attachments: attachmentsSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  parent: parent6f1635Schema.optional(),
  description: cycle883343Schema.optional(),
  comment_json: commentjsonSchema.optional(),
})

const datab4280dSchema = z.array(planeV2WorkItemComments8b4ed9Schema)

export const planeV2V2ListCommentsresultSchema = z.object({
  data: datab4280dSchema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemCommentd35106Schema = z.object({
  id: idSchema.optional(),
  is_member: isMemberSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  comment_stripped: commentStrippedSchema.optional(),
  comment_html: commentHtmlSchema.optional(),
  attachments: attachmentsSchema.optional(),
  access: access11dbb2Schema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  edited_at: editedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  actor: actorf9564cSchema.optional(),
  parent: parent6f1635Schema.optional(),
  description: cycle883343Schema.optional(),
  name: assetIdSchema.optional(),
})

export const planeV2WorkItemLinks329bc3Schema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id835e8aSchema.optional(),
  metadata: metadataf0a51fSchema.optional(),
  title: titled12a0dSchema.optional(),
  url: urlc17248Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
})

export const planeV2WorkItemLinks5e13edSchema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  id: id835e8aSchema.optional(),
  metadata: metadataf0a51fSchema.optional(),
  title: titled12a0dSchema.optional(),
  url: urlc17248Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  grouped_by: assetIdSchema.optional(),
  sub_grouped_by: assetIdSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: assetIdSchema.optional(),
  prev_cursor: assetIdSchema.optional(),
  next_page_results: hasPages8e2bc3Schema.optional(),
  prev_page_results: hasPages8e2bc3Schema.optional(),
  count: access644595Schema.optional(),
  total_pages: access644595Schema.optional(),
  total_results: access644595Schema.optional(),
  extra_stats: extraStatsSchema.optional(),
  results: results803362Schema.optional(),
})

export const planeV2V2ListLinksresultSchema = z.object({
  data: data8c69baSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemLinkbd3aa8Schema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  title: titleSchema.optional(),
  url: urlSchema.optional(),
  metadata: metadataSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  name: assetIdSchema.optional(),
})

export const planeV2V2ListWorkItemPropertiesresultSchema = z.object({
  data: data6fd798Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListPropertyContextsresultSchema = z.object({
  data: data62c3e9Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemPropertyOption62bf89Schema = z.object({
  id: idSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  sort_order: sortOrderSchema.optional(),
  description: descriptionSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  is_active: isActiveSchema.optional(),
  is_default: isDefaultSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  project: project0bf380Schema.optional(),
  property: propertySchema.optional(),
  parent: parent6f1635Schema.optional(),
})

const id98544cSchema = z.union([idd4c25aSchema, assetIdSchema, id045d22Schema])

const descriptiona18db4Schema = z.union([description02f63aSchema, assetIdSchema, id045d22Schema])

const isDefault445c3bSchema = z.union([isDefault7f68b1Schema, hasPages8e2bc3Schema, id045d22Schema])

const sortOrder3cfe65Schema = z.union([
  sortOrder6c977aSchema,
  access644595Schema,
  sortOrderdde3e5Schema,
  id045d22Schema,
])

export const planeV2WorkItemPropertyOptionsf0877fSchema = z.object({
  id: id98544cSchema.optional(),
  name: name85421bSchema.optional(),
  description: descriptiona18db4Schema.optional(),
  is_default: isDefault445c3bSchema.optional(),
  sort_order: sortOrder3cfe65Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  is_active: isActiveSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  project: project0bf380Schema.optional(),
  property: propertySchema.optional(),
  parent: parent6f1635Schema.optional(),
})

export const planeV2V2ListPropertyOptionsresultSchema = z.object({
  data: data313b27Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2AttachTypePropertyresultSchema = z.object({
  properties: defaultValuecb839fSchema.optional(),
})

export const planeV2V2ListTypePropertiesresultSchema = z.object({
  data: datad55667Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemTypea15c03Schema = z.object({
  id: idSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  project_ids: projectIdsSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  is_epic: isEpicSchema.optional(),
  is_default: isDefaultSchema.optional(),
  is_active: isActiveSchema.optional(),
  level: levelSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
})

const id5e100aSchema = z.union([id9503bbSchema, assetIdSchema, id045d22Schema])

const description1f7691Schema = z.union([description0caf0fSchema, assetIdSchema, id045d22Schema])

const isActive4162ecSchema = z.union([isActive8a5ec5Schema, hasPages8e2bc3Schema, id045d22Schema])

const isDefaulte8a1eaSchema = z.union([isDefault13e882Schema, hasPages8e2bc3Schema, id045d22Schema])

const isEpic3eb7b7Schema = z.union([isEpicbb1a89Schema, hasPages8e2bc3Schema, id045d22Schema])

const level336c1aSchema = z.union([level7eaf46Schema, access644595Schema, id045d22Schema])

const logoProps3eb47bSchema = z.union([
  logoProps669c69Schema,
  logoPropsb439a5Schema,
  logoProps44136fSchema,
  id045d22Schema,
])

const createdAtd2219cSchema = z.union([createdAtf6a685Schema, assetIdSchema, id045d22Schema])

export const planeV2WorkItemTypes056c22Schema = z.object({
  id: id5e100aSchema.optional(),
  name: name75d552Schema.optional(),
  description: description1f7691Schema.optional(),
  is_active: isActive4162ecSchema.optional(),
  is_default: isDefaulte8a1eaSchema.optional(),
  is_epic: isEpic3eb7b7Schema.optional(),
  level: level336c1aSchema.optional(),
  logo_props: logoProps3eb47bSchema.optional(),
  created_at: createdAtd2219cSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  project_ids: projectIdsSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
})

export const planeV2V2GetWorkItemTypeSchemaresultSchema = z.object({
  type_id: assetIdSchema.optional(),
  type_name: assetIdSchema.optional(),
  type_description: assetIdSchema.optional(),
  type_logo_props: planeV2TypeLogoPropsSchema.optional(),
  fields: planeV2FieldsSchema.optional(),
  custom_fields: logoPropsb439a5Schema.optional(),
})

export const planeV2V2ListWorkItemTypesresultSchema = z.object({
  data: data1ba868Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2WorkItemWorklogs111186Schema = z.object({
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  duration: durationcec84dSchema.optional(),
  id: id35193dSchema.optional(),
  logged_by_id: loggedByIdSchema.optional(),
  updated_at: updatedAt579fb8Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  logged_by: customFields9c1322Schema.optional(),
})

export const workItemWorkLog7cf3b8Schema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  description: descriptionSchema.optional(),
  duration: durationSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project_id: projectIdSchema.optional(),
  workspace_id: workspaceId41dad2Schema.optional(),
  logged_by: loggedBySchema.optional(),
})

const durationcf388aSchema = z.union([durationcec84dSchema, access644595Schema, id045d22Schema])

const updatedAtf8b0d7Schema = z.union([updatedAt579fb8Schema, assetIdSchema, id045d22Schema])

export const planeV2WorkItemWorklogsd59c1cSchema = z.object({
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description16907bSchema.optional(),
  duration: durationcf388aSchema.optional(),
  id: id835e8aSchema.optional(),
  logged_by_id: loggedByIdSchema.optional(),
  updated_at: updatedAtf8b0d7Schema.optional(),
  work_item_id: workItemIdSchema.optional(),
  logged_by: ownedBy18e538Schema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project_id: projectIdSchema.optional(),
  workspace_id: workspaceId41dad2Schema.optional(),
})

export const planeV2V2GetProjectWorklogSummaryresultitem9fe59dSchema = z.object({
  duration: access644595Schema.optional(),
  work_item_id: assetIdSchema.optional(),
  issue_id: issueIdSchema.optional(),
})

const data82834cSchema = z.array(planeV2WorkItemWorklogs111186Schema)

export const planeV2V2ListWorklogsresultSchema = z.object({
  data: data82834cSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2WorkItems0209d1Schema = z.object({
  id: idb23e78Schema.optional(),
  name: name6f7b53Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceIdfb3d8dSchema.optional(),
  priority: prioritydca6ceSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsSchema.optional(),
  label_ids: labelIds958cbcSchema.optional(),
  parent_id: parentIde65d55Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraft88b48cSchema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt083e6eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: customFields9c1322Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: pointsSchema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
})

export const planeV2V2BulkCreateWorkItemsresultSchema = z.object({
  results: resultsd78556Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkDeleteWorkItemsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

export const planeV2V2BulkUpdateWorkItemsresultSchema = z.object({
  results: results0a57a3Schema.optional(),
  succeeded: access644595Schema.optional(),
  failed: access644595Schema.optional(),
})

const id3b71dcSchema = z.union([idb23e78Schema, assetIdSchema, id045d22Schema])

const name1b9841Schema = z.union([name6f7b53Schema, assetIdSchema, id045d22Schema])

const sequenceId215cccSchema = z.union([
  sequenceIdfb3d8dSchema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const priorityee2bcdSchema = z.union([prioritydca6ceSchema, priorityb96bbbSchema, id045d22Schema])

const isDraft402c37Schema = z.union([isDraft88b48cSchema, hasPages8e2bc3Schema, id045d22Schema])

const createdAt5b0ae6Schema = z.union([createdAt083e6eSchema, assetIdSchema, id045d22Schema])

const assigneesItem905d4eSchema = z.object({
  id: assetIdSchema.optional(),
  display_name: assetIdSchema.optional(),
  avatar_url: cycle883343Schema.optional(),
  email: assetIdSchema.optional(),
  first_name: assetIdSchema.optional(),
  last_name: assetIdSchema.optional(),
  avatar: assetIdSchema.optional(),
})

const assigneesItemc6aea9Schema = z.union([assetIdSchema, assigneesItem905d4eSchema])

const assigneesb6479cSchema = z.array(assigneesItemc6aea9Schema)

const parent848f9cSchema = z.union([id045d22Schema, assetIdSchema, parent31201dSchema])

const group86867eSchema = z.union([assetIdSchema, groupb0d31eSchema, id045d22Schema])

const state93d6f1Schema = z.object({
  id: cycle883343Schema.optional(),
  name: cycle883343Schema.optional(),
  color: cycle883343Schema.optional(),
  group: group86867eSchema.optional(),
})

const state7f27f1Schema = z.union([id045d22Schema, assetIdSchema, state93d6f1Schema])

const type65a531Schema = z.union([
  id045d22Schema,
  assetIdSchema,
  settings43c814Schema,
  type071f88Schema,
])

export const planeV2WorkItems90ffdaSchema = z.object({
  id: id3b71dcSchema.optional(),
  name: name1b9841Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceId215cccSchema.optional(),
  priority: priorityee2bcdSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsSchema.optional(),
  label_ids: labelIds958cbcSchema.optional(),
  parent_id: parentIde65d55Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraft402c37Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt5b0ae6Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  assignees: assigneesb6479cSchema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labels3303c8Schema.optional(),
  modules: pointsSchema.optional(),
  parent: parent848f9cSchema.optional(),
  state: state7f27f1Schema.optional(),
  type: type65a531Schema.optional(),
  project_id: assetIdSchema.optional(),
  cycle_id: cycleIdSchema.optional(),
  module_ids: labelIdsSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  point: pointSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  sort_order: sortOrderSchema.optional(),
  completed_at: completedAtSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project30aa14Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  estimate_point: estimatePoint1c3278Schema.optional(),
  description: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
  created_via: id045d22Schema.optional(),
  updated_via: id045d22Schema.optional(),
  last_activity_at: assetIdSchema.optional(),
  min_assignee_first_name: cycleIdSchema.optional(),
  min_label_name: cycleIdSchema.optional(),
  min_module_name: cycleIdSchema.optional(),
  priority_rank: priorityRankSchema.optional(),
  state_group: cycle883343Schema.optional(),
})

export const planeV2WorkItems49553eSchema = z.object({
  id: idb23e78Schema.optional(),
  name: name6f7b53Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceIdfb3d8dSchema.optional(),
  priority: prioritydca6ceSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsSchema.optional(),
  label_ids: labelIds958cbcSchema.optional(),
  parent_id: parentIde65d55Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraft88b48cSchema.optional(),
  archived_at: archivedAt90ed0eSchema.optional(),
  created_at: createdAt083e6eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: pointsSchema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
  project_id: assetIdSchema.optional(),
  cycle_id: id045d22Schema.optional(),
  module_ids: labelIdsSchema.optional(),
})

const planeV2State9c8b68Schema = z.object({
  id: cycle883343Schema.optional(),
  name: cycle883343Schema.optional(),
  color: cycle883343Schema.optional(),
  group: group86867eSchema.optional(),
})

const statebb5f68Schema = z.union([assetIdSchema, id045d22Schema, planeV2State9c8b68Schema])

const planeV2Assigneesitemb791ceSchema = z.object({
  id: cycle883343Schema.optional(),
  display_name: cycle883343Schema.optional(),
  avatar_url: cycle883343Schema.optional(),
  email: cycle883343Schema.optional(),
  first_name: cycle883343Schema.optional(),
  last_name: cycle883343Schema.optional(),
  avatar: cycle883343Schema.optional(),
})

const assigneesItembc31edSchema = z.union([assetIdSchema, planeV2Assigneesitemb791ceSchema])

const assigneesbd8112Schema = z.array(assigneesItembc31edSchema)

const assigneese78af7Schema = assigneesbd8112Schema

const labelsItem79c387Schema = z.object({
  id: cycle883343Schema.optional(),
  name: assetIdSchema.optional(),
  color: cycle883343Schema.optional(),
  deleted_by: id045d22Schema.optional(),
  created_at: cycle883343Schema.optional(),
  updated_at: cycle883343Schema.optional(),
  deleted_at: cycleIdSchema.optional(),
  description: cycle883343Schema.optional(),
  sort_order: priorityRankSchema.optional(),
  external_source: cycleIdSchema.optional(),
  external_id: cycleIdSchema.optional(),
  created_by: cycle883343Schema.optional(),
  updated_by: cycleIdSchema.optional(),
  workspace: cycle883343Schema.optional(),
  project: cycle883343Schema.optional(),
  parent: cycleIdSchema.optional(),
})

const labelsIteme6cc5dSchema = z.union([assetIdSchema, labelsItem79c387Schema])

const labelsa1887dSchema = z.array(labelsIteme6cc5dSchema)

const labelsdb08cdSchema = labelsa1887dSchema

export const planeV2WorkItems3d744cSchema = z.object({
  id: id3b71dcSchema.optional(),
  name: name1b9841Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceId215cccSchema.optional(),
  priority: priorityee2bcdSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsSchema.optional(),
  label_ids: labelIds958cbcSchema.optional(),
  parent_id: parentIde65d55Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraft402c37Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt5b0ae6Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  state: statebb5f68Schema.optional(),
  assignees: assigneese78af7Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsdb08cdSchema.optional(),
  modules: pointsSchema.optional(),
  parent: parent848f9cSchema.optional(),
  type: type65a531Schema.optional(),
  project_id: assetIdSchema.optional(),
  cycle_id: cycleIdSchema.optional(),
  module_ids: labelIdsSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  point: pointSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  sort_order: sortOrderSchema.optional(),
  completed_at: completedAtSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project30aa14Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  estimate_point: estimatePoint1c3278Schema.optional(),
  description: assetIdSchema.optional(),
  deleted_by: id045d22Schema.optional(),
  created_via: id045d22Schema.optional(),
  updated_via: id045d22Schema.optional(),
  last_activity_at: assetIdSchema.optional(),
  min_assignee_first_name: cycleIdSchema.optional(),
  min_label_name: cycleIdSchema.optional(),
  min_module_name: cycleIdSchema.optional(),
  priority_rank: priorityRankSchema.optional(),
  state_group: cycle883343Schema.optional(),
})

const planeV2WorkItemsbb7aaaSchema = z.object({
  id: idb23e78Schema.optional(),
  name: name6f7b53Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceIdfb3d8dSchema.optional(),
  priority: prioritydca6ceSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: typeIddf3325Schema.optional(),
  assignee_ids: assigneeIdsSchema.optional(),
  label_ids: labelIds958cbcSchema.optional(),
  parent_id: parentIde65d55Schema.optional(),
  start_date: startDate1cc4bcSchema.optional(),
  target_date: targetDate7254f2Schema.optional(),
  is_draft: isDraft88b48cSchema.optional(),
  archived_at: archivedAt90ed0eSchema.optional(),
  created_at: createdAt083e6eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: pointsSchema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
  project_id: assetIdSchema.optional(),
  cycle_id: id045d22Schema.optional(),
  module_ids: labelIdsSchema.optional(),
})

const data4c0d90Schema = z.array(planeV2WorkItemsbb7aaaSchema)

const previouse7d2afSchema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

export const planeV2V2ListWorkItemsresultSchema = z.object({
  data: data4c0d90Schema.optional(),
  next: previousSchema.optional(),
  previous: previouse7d2afSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const state5ff5fdSchema = z.union([assetIdSchema, stateLiteSchema, id045d22Schema])

const assigneesItemef8ad1Schema = z.union([assigneesItem3fe93dSchema, assetIdSchema])

const assigneesc7c467Schema = z.array(assigneesItemef8ad1Schema)

const labelsItemea0679Schema = z.union([labelsItem7d556aSchema, assetIdSchema])

const labels6ff712Schema = z.array(labelsItemea0679Schema)

export const workItemdc8a1dSchema = z.object({
  id: idSchema.optional(),
  type_id: typeIdSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  point: pointSchema.optional(),
  name: nameSchema.optional(),
  description_html: descriptionHtmlSchema.optional(),
  description_stripped: descriptionStrippedSchema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  priority: priority7c079dSchema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  sequence_id: sequenceId6a702bSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  completed_at: completedAtSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  is_draft: isDraftSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project30aa14Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  parent: parent6f1635Schema.optional(),
  state: state5ff5fdSchema.optional(),
  estimate_point: estimatePoint1c3278Schema.optional(),
  type: typeSchema.optional(),
  description: assetIdSchema.optional(),
  assignees: assigneesc7c467Schema.optional(),
  labels: labels6ff712Schema.optional(),
  deleted_by: id045d22Schema.optional(),
  cycle_id: cycleIdSchema.optional(),
  created_via: id045d22Schema.optional(),
  updated_via: id045d22Schema.optional(),
  last_activity_at: assetIdSchema.optional(),
  min_assignee_first_name: cycleIdSchema.optional(),
  min_label_name: cycleIdSchema.optional(),
  min_module_name: cycleIdSchema.optional(),
  priority_rank: priorityRankSchema.optional(),
  state_group: cycle883343Schema.optional(),
})

const sequenceIdc3ad4dSchema = z.union([
  sequenceIdfb3d8dSchema,
  assetIdSchema,
  sortOrderdde3e5Schema,
])

const planeV2WorkItemsf4fadbSchema = z.object({
  id: idb23e78Schema.optional(),
  name: name6f7b53Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceIdc3ad4dSchema.optional(),
  priority: prioritydca6ceSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIds2de275Schema.optional(),
  label_ids: labelIds16374aSchema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraft88b48cSchema.optional(),
  archived_at: archivedAt90ed0eSchema.optional(),
  created_at: createdAt083e6eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  cycle_id: cycle883343Schema.optional(),
  module_ids: projectIds76d572Schema.optional(),
  project_id: assetIdSchema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: pointsSchema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
})

const data1d8ff3Schema = z.array(planeV2WorkItemsf4fadbSchema)

export const planeV2V2ListWorkspaceWorkItemsresultSchema = z.object({
  data: data1d8ff3Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2WorkItems029d81Schema = z.object({
  id: idb23e78Schema.optional(),
  name: name6f7b53Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceIdfb3d8dSchema.optional(),
  priority: prioritydca6ceSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsSchema.optional(),
  label_ids: labelIds958cbcSchema.optional(),
  parent_id: parentIde65d55Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraft88b48cSchema.optional(),
  archived_at: archivedAt90ed0eSchema.optional(),
  created_at: createdAt083e6eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: customFields9c1322Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: pointsSchema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
})

export const planeV2WorkItemsa7b6deSchema = z.object({
  id: idb23e78Schema.optional(),
  name: name6f7b53Schema.optional(),
  identifier: identifier4f4557Schema.optional(),
  sequence_id: sequenceId3a1eacSchema.optional(),
  priority: prioritydca6ceSchema.optional(),
  state_id: stateId55c66bSchema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIds2de275Schema.optional(),
  label_ids: labelIds16374aSchema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraft88b48cSchema.optional(),
  archived_at: archivedAt90ed0eSchema.optional(),
  created_at: createdAt083e6eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: customFields9c1322Schema.optional(),
  cycle_id: assetIdSchema.optional(),
  module_ids: projectIds76d572Schema.optional(),
  project_id: assetIdSchema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: pointsSchema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
})

export const planeV2V2ListWorkflowStatesresultSchema = z.object({
  data: dataa8c811Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkflowTransitionsresultSchema = z.object({
  data: data76a8fdSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkflowsresultSchema = z.object({
  data: data88dc10Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2WorkspaceAssets33620dSchema = z.object({
  asset_url: assetUrlSchema.optional(),
  attributes: attributes2ff54bSchema.optional(),
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  entity_type: entityType7582d6Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedb45807Schema.optional(),
  name: namef3ca52Schema.optional(),
  size: size422d69Schema.optional(),
  asset_id: assetIdSchema.optional(),
  upload_data: uploadData27f4dfSchema.optional(),
})

const attributes6781caSchema = z.union([attributesd762a0Schema, id045d22Schema, attributesSchema])

export const planeV2WorkspaceAssets0c0a0aSchema = z.object({
  asset_url: assetUrlSchema.optional(),
  attributes: attributes6781caSchema.optional(),
  content_type: contentTypeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  entity_type: entityType7582d6Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedb45807Schema.optional(),
  name: namef3ca52Schema.optional(),
  size: size422d69Schema.optional(),
  type: assetIdSchema.optional(),
})

export const planeV2V2ListWorkspaceAssetsresultSchema = z.object({
  data: datab73db2Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceAutomationActivitiesresultSchema = z.object({
  data: data92a59eSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceAutomationEdgesresultSchema = z.object({
  data: dataedfcaeSchema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceAutomationNodesresultSchema = z.object({
  data: data23f884Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceAutomationsresultSchema = z.object({
  data: data307069Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2WorkspaceRegenerateNodeWebhookSecretresultSchema = z.object({
  secret: assetIdSchema.optional(),
})

export const planeV2WorkspaceFeatures56caddSchema = z.object({
  id: idde4acbSchema.optional(),
  is_work_item_types_enabled: isWorkItemTypesEnabledSchema.optional(),
  work_item_type_default_level: workItemTypeDefaultLevelSchema.optional(),
  is_workitem_hierarchy_enabled: isWorkitemHierarchyEnabledSchema.optional(),
  is_project_grouping_enabled: isProjectGroupingEnabledSchema.optional(),
  is_teams_enabled: isTeamsEnabledSchema.optional(),
  is_wiki_enabled: isWikiEnabledSchema.optional(),
  is_initiative_enabled: isInitiativeEnabledSchema.optional(),
  is_customer_enabled: isCustomerEnabledSchema.optional(),
  is_release_enabled: isReleaseEnabledSchema.optional(),
  is_state_duration_enabled: isStateDurationEnabledSchema.optional(),
  is_pi_enabled: isPiEnabledSchema.optional(),
  created_at: createdAt15f92dSchema.optional(),
  project_grouping: projectGroupingSchema.optional(),
  initiatives: initiativesSchema.optional(),
  teams: teamsSchema.optional(),
  customers: customersSchema.optional(),
  wiki: wikiSchema.optional(),
  pi: piSchema.optional(),
  work_item_types: workItemTypesSchema.optional(),
  releases: releasesSchema.optional(),
  states_owned_by_workspace: statesOwnedByWorkspaceSchema.optional(),
})

const planeV2WorkspacePages81fa05Schema = z.object({
  access: access97d6dbSchema.optional(),
  archived_at: archivedAt31ccceSchema.optional(),
  collection_id: collectionId856ec9Schema.optional(),
  color: color3938eeSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml92a7e9Schema.optional(),
  description_stripped: descriptionStrippedba3b79Schema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id35193dSchema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  is_locked: isLockedca86cfSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  parent_id: parentId280851Schema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  view_props: viewProps67dac8Schema.optional(),
  owned_by: customFields9c1322Schema.optional(),
  parent: customFields9c1322Schema.optional(),
})

const collectionId81d695Schema = z.union([collectionId856ec9Schema, assetIdSchema, id045d22Schema])

const logoPropsada1beSchema = z.union([
  logoPropsb599b9Schema,
  id045d22Schema,
  logoPropsb439a5Schema,
  assetIdSchema,
])

const parentIde8884dSchema = z.union([parentId280851Schema, assetIdSchema, id045d22Schema])

const viewProps4552d6Schema = z.union([
  viewProps919a47Schema,
  id045d22Schema,
  logoPropsb439a5Schema,
  assetIdSchema,
])

export const planeV2WorkspacePagesd6a399Schema = z.object({
  access: access5296b7Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  collection_id: collectionId81d695Schema.optional(),
  color: color3938eeSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  description_stripped: descriptionStripped03385fSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  is_locked: isLocked7fd353Schema.optional(),
  logo_props: logoPropsada1beSchema.optional(),
  name: name8b7867Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  parent_id: parentIde8884dSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  view_props: viewProps4552d6Schema.optional(),
  owned_by: ownedBy18e538Schema.optional(),
  parent: customFields9c1322Schema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  description: descriptionb39dcdSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  anchor: anchorSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  projects: projectsSchema.optional(),
  page_collection_id: pageCollectionIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: cycle883343Schema.optional(),
  description_json: descriptionJson0b33adSchema.optional(),
})

export const planeV2WorkspacePagesc8362fSchema = z.object({
  access: access5296b7Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  collection_id: collectionId81d695Schema.optional(),
  color: color3938eeSchema.optional(),
  created_at: createdAt88654eSchema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description_html: descriptionHtml605ec1Schema.optional(),
  description_stripped: descriptionStripped03385fSchema.optional(),
  external_id: externalIde53bcdSchema.optional(),
  external_source: externalSourceeb04b9Schema.optional(),
  id: id835e8aSchema.optional(),
  is_global: isGlobal48e7dfSchema.optional(),
  is_locked: isLocked7fd353Schema.optional(),
  logo_props: logoPropsada1beSchema.optional(),
  name: name8b7867Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  parent_id: parentIde8884dSchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  view_props: viewProps4552d6Schema.optional(),
  owned_by: ownedBy18e538Schema.optional(),
  parent: customFields9c1322Schema.optional(),
  description_binary: descriptionBinarySchema.optional(),
  description: descriptionb39dcdSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  anchor: anchorSchema.optional(),
  workspace: workspace8d2899Schema.optional(),
  projects: projectsSchema.optional(),
  page_collection_id: pageCollectionIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: id045d22Schema.optional(),
  description_json: descriptionJson0b33adSchema.optional(),
})

const data9b4d85Schema = z.array(planeV2WorkspacePages81fa05Schema)

export const planeV2V2ListWorkspacePagesresultSchema = z.object({
  data: data9b4d85Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2WorkspaceViews490e6dSchema = z.object({
  access: access97d6dbSchema.optional(),
  archived_at: archivedAt31ccceSchema.optional(),
  created_at: createdAt50e5d2Schema.optional(),
  created_by_id: createdByIdSchema.optional(),
  description: description36d05fSchema.optional(),
  display_filters: displayFiltersSchema.optional(),
  display_properties: displayPropertiesSchema.optional(),
  filters: filtersSchema.optional(),
  id: id35193dSchema.optional(),
  is_locked: isLockedca86cfSchema.optional(),
  logo_props: logoProps06abc6Schema.optional(),
  name: namef3ca52Schema.optional(),
  owned_by_id: ownedById53bb5aSchema.optional(),
  pql_filters: pqlFiltersSchema.optional(),
  query: querySchema.optional(),
  sort_order: sortOrderddaa43Schema.optional(),
  owned_by: customFields9c1322Schema.optional(),
})

const dataedbd49Schema = z.array(planeV2WorkspaceViews490e6dSchema)

export const planeV2V2ListWorkspaceViewsresultSchema = z.object({
  data: dataedbd49Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceWorkItemPropertiesresultSchema = z.object({
  data: datac76cc1Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspacePropertyOptionsresultSchema = z.object({
  data: dataeee2f9Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceWorkItemTemplatesresultSchema = z.object({
  data: data99d8d4Schema.optional(),
  next: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: access644595Schema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2AttachWorkspaceTypePropertyresultSchema = z.object({
  properties: defaultValuecb839fSchema.optional(),
})

export const planeV2V2ListWorkspaceTypePropertiesresultSchema = z.object({
  data: data6a7b72Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2V2ListWorkspaceWorkItemTypesresultSchema = z.object({
  data: data74c95eSchema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const page918175Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  access: access644595Schema.optional(),
  logo_props: logopropse73098Schema.optional(),
  parent_id: parentId64f4aeSchema.optional(),
  collection_id: assetIdSchema.optional(),
  workspace: assetIdSchema.optional(),
  sub_pages_count: access644595Schema.optional(),
  is_shared: hasPages8e2bc3Schema.optional(),
  owned_by: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
  is_favorite: hasPages8e2bc3Schema.optional(),
  label_ids: labelIdsSchema.optional(),
})

const pagef74376Schema = z.union([page918175Schema, id045d22Schema])

export const collectionBranchPageeda77cSchema = z.object({
  page_collection_id: pageCollectionIdSchema.optional(),
  collection_id: collectionIdSchema.optional(),
  parent_id: parentIdSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  page: pagef74376Schema.optional(),
})

export const cycle8c1c16Schema = z.object({
  id: idSchema.optional(),
  total_issues: totalIssuesSchema.optional(),
  cancelled_issues: cancelledIssuesSchema.optional(),
  completed_issues: completedIssuesSchema.optional(),
  started_issues: startedIssuesSchema.optional(),
  unstarted_issues: unstartedIssuesSchema.optional(),
  backlog_issues: backlogIssuesSchema.optional(),
  total_estimates: totalEstimatesSchema.optional(),
  completed_estimates: completedEstimatesSchema.optional(),
  started_estimates: startedEstimatesSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  start_date: startDateSchema.optional(),
  end_date: endDateSchema.optional(),
  view_props: viewPropsSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  progress_snapshot: progressSnapshotSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  timezone: timezoneSchema.optional(),
  version: versionSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  owned_by: ownedBy4be915Schema.optional(),
})

export const planeUpdateProjectMappingByKeyResult5729c9Schema = z.object({
  id: assetIdSchema.optional(),
  idp_group_name: assetIdSchema.optional(),
  project: assetIdSchema.optional(),
  all_projects: hasPages8e2bc3Schema.optional(),
  role: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

export const modulee68880Schema = z.object({
  id: idSchema.optional(),
  total_issues: totalIssuesSchema.optional(),
  cancelled_issues: cancelledIssuesSchema.optional(),
  completed_issues: completedIssuesSchema.optional(),
  started_issues: startedIssuesSchema.optional(),
  unstarted_issues: unstartedIssuesSchema.optional(),
  backlog_issues: backlogIssuesSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  name: nameeb0f45Schema.optional(),
  description: descriptionSchema.optional(),
  description_text: descriptionTextSchema.optional(),
  description_html: descriptionHtmlfa4901Schema.optional(),
  start_date: startDateSchema.optional(),
  target_date: targetDateSchema.optional(),
  status: statusSchema.optional(),
  view_props: viewPropsSchema.optional(),
  sort_order: sortOrderSchema.optional(),
  external_source: externalSourceSchema.optional(),
  external_id: externalIdSchema.optional(),
  archived_at: archivedAtSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  lead: leadSchema.optional(),
  members: defaultValuecb839fSchema.optional(),
})

export const planeCreateProjectWithTemplateResultbb886aSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  description: assetIdSchema.optional(),
  identifier: assetIdSchema.optional(),
  network: access644595Schema.optional(),
  project_lead: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
})

const workItemPageLite8fdf22Schema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  is_global: isGlobalSchema.optional(),
  logo_props: logoPropsSchema.optional(),
  description_html: assetIdSchema.optional(),
})

const page816670Schema = z.union([workItemPageLite8fdf22Schema, id045d22Schema])

export const workItemPagecac7c5Schema = z.object({
  id: idSchema.optional(),
  page: page816670Schema.optional(),
  issue: issueSchema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
})

const workItemPageLite672e78Schema = z.object({
  id: idSchema.optional(),
  name: nameSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  is_global: isGlobalSchema.optional(),
  logo_props: logoPropsSchema.optional(),
})

const pageff2aa2Schema = z.union([workItemPageLite672e78Schema, id045d22Schema])

export const workItemPage3d85b8Schema = z.object({
  id: idSchema.optional(),
  page: pageff2aa2Schema.optional(),
  issue: issueSchema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  name: assetIdSchema.optional(),
})

export const planeCreateWorkItemRelationResultItemItem5c3495Schema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  sequence_id: access644595Schema.optional(),
  project_id: assetIdSchema.optional(),
  relation_type: assetIdSchema.optional(),
  state_id: assetIdSchema.optional(),
  priority: assetIdSchema.optional(),
  type_id: assetIdSchema.optional(),
  is_epic: hasPages8e2bc3Schema.optional(),
  created_at: assetIdSchema.optional(),
  updated_at: assetIdSchema.optional(),
  created_by: assetIdSchema.optional(),
  updated_by: assetIdSchema.optional(),
})

export const cycleWorkItem639ff1Schema = z.object({
  id: idSchema.optional(),
  sub_issues_count: subIssuesCountSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  cycle: cycleSchema.optional(),
})
