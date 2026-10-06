import { z } from 'zod'

const assetIdSchema = z.string()

const fieldsSchema = z.record(z.string(), assetIdSchema)

const id045d22Schema = z.null()

const idSchema = z.union([assetIdSchema, id045d22Schema])

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

const createdAtSchema = z.union([assetIdSchema, id045d22Schema])

const updatedAtSchema = z.union([assetIdSchema, id045d22Schema])

const pageSchema = z.union([assetIdSchema, id045d22Schema])

const sortOrderdde3e5Schema = z.number()

const sortOrderSchema = z.union([sortOrderdde3e5Schema, id045d22Schema])

const nameSchema = z.union([assetIdSchema, id045d22Schema])

const hasPages8e2bc3Schema = z.boolean()

const logoProps44136fSchema = z.json()

const logoPropsSchema = z.union([logoProps44136fSchema, id045d22Schema])

const pageCollectionIdSchema = z.union([assetIdSchema, id045d22Schema])

const collectionIdSchema = z.union([assetIdSchema, id045d22Schema])

const parentIdSchema = z.union([assetIdSchema, id045d22Schema])

const access644595Schema = z.number()

const deletedAtSchema = z.union([assetIdSchema, id045d22Schema])

const descriptionSchema = z.union([assetIdSchema, id045d22Schema])

const defaultValuecb839fSchema = z.array(assetIdSchema)

const settings43c814Schema = z.record(z.string(), z.json())

const externalSourceSchema = z.union([assetIdSchema, id045d22Schema])

const externalIdSchema = z.union([assetIdSchema, id045d22Schema])

const nameeb0f45Schema = z.string()

const description2c8fe8Schema = z.union([logoProps44136fSchema, id045d22Schema])

const descriptionHtmlSchema = z.union([assetIdSchema, id045d22Schema])

const descriptionStrippedSchema = z.union([assetIdSchema, id045d22Schema])

const descriptionBinarySchema = z.union([assetIdSchema, id045d22Schema])

const archivedAtSchema = z.union([assetIdSchema, id045d22Schema])

const ide04262Schema = z.string()

const sequenceIdSchema = z.union([access644595Schema, id045d22Schema])

const projectIdSchema = z.union([assetIdSchema, id045d22Schema])

const detailSchema = z.string()

const identifierSchema = z.string()

const coverImageSchema = z.union([assetIdSchema, id045d22Schema])

const iconPropSchema = z.union([logoProps44136fSchema, id045d22Schema])

const emojiSchema = z.union([assetIdSchema, id045d22Schema])

const coverImageUrlSchema = z.union([assetIdSchema, id045d22Schema])

const issueSchema = z.union([assetIdSchema, id045d22Schema])

const cycleSchema = z.union([assetIdSchema, id045d22Schema])

const totalEstimatesSchema = z.union([access644595Schema, id045d22Schema])

const completedEstimatesSchema = z.union([access644595Schema, id045d22Schema])

const startedEstimatesSchema = z.union([access644595Schema, id045d22Schema])

const startDateSchema = z.union([assetIdSchema, id045d22Schema])

const endDateSchema = z.union([assetIdSchema, id045d22Schema])

const viewPropsSchema = z.union([logoProps44136fSchema, id045d22Schema])

const timezoneSchema = z.union([assetIdSchema, id045d22Schema])

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

const createdBy94a812Schema = z.union([assetIdSchema, id045d22Schema])

const updatedBy1f6d11Schema = z.union([assetIdSchema, id045d22Schema])

const project0bf380Schema = z.union([assetIdSchema, id045d22Schema])

const workspace8d2899Schema = z.union([assetIdSchema, id045d22Schema])

const typeSchema = z.union([assetIdSchema, settings43c814Schema, id045d22Schema])

const cycle883343Schema = z.union([assetIdSchema, id045d22Schema])

const project4c8ec3Schema = z.string()

const workspace259123Schema = z.string()

const leadSchema = z.union([assetIdSchema, id045d22Schema])

const isMemberSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isDeployedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const descriptionTextSchema = z.union([logoProps44136fSchema, id045d22Schema])

const descriptionHtmlfa4901Schema = z.union([logoProps44136fSchema, id045d22Schema])

const moduleViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const cycleViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const issueViewsViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const pageViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const intakeViewSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isTimeTrackingEnabledSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isIssueTypeEnabledSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const guestViewAllFeaturesSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const timezone467abfSchema = z.string()

const timezone7677ddSchema = z.union([timezone467abfSchema, id045d22Schema])

const coverImageAssetSchema = z.union([assetIdSchema, id045d22Schema])

const defaultStateSchema = z.union([assetIdSchema, id045d22Schema])

const extraStatsSchema = z.json()

const cyclec886e3Schema = z.union([logoProps44136fSchema, id045d22Schema])

const statusd21fa3Schema = z.string()

const statusSchema = z.union([statusd21fa3Schema, id045d22Schema])

const membersSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const commentSchema = z.union([assetIdSchema, id045d22Schema])

const attachmentsSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const resultsItemb8d56eSchema = z.object({
  id: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
  created_at: assetIdSchema.optional(),
})

const results803362Schema = z.array(resultsItemb8d56eSchema)

const assetSchema = z.string()

const entityTypeSchema = z.union([assetIdSchema, id045d22Schema])

const entityIdentifierSchema = z.union([assetIdSchema, id045d22Schema])

const isDeletedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isArchivedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const isUploadedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

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

const titleSchema = z.union([assetIdSchema, id045d22Schema])

const urlSchema = z.string()

const module83515fSchema = z.union([assetIdSchema, id045d22Schema])

const descriptionb39dcdSchema = z.union([settings43c814Schema, assetIdSchema, id045d22Schema])

const anchorSchema = z.union([assetIdSchema, id045d22Schema])

const projectsSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

const isLockedSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const colorbba70bSchema = z.string()

const sequenceSchema = z.union([sortOrderdde3e5Schema, id045d22Schema])

const isTriageSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const defaultSchema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const previousSchema = z.union([access644595Schema, id045d22Schema])

const planeV2PaginationSchema = z.object({
  style: assetIdSchema.optional(),
})

const access97d6dbSchema = z.number()

const createdAt50e5d2Schema = z.string()

const createdByIdSchema = z.string()

const id35193dSchema = z.string()

const isGlobal48e7dfSchema = z.boolean()

const namef3ca52Schema = z.string()

const ownedById53bb5aSchema = z.string()

const sortOrder7c3a9eSchema = z.number()

const description36d05fSchema = z.string()

const externalIdba2ed6Schema = z.string()

const externalIde53bcdSchema = z.union([externalIdba2ed6Schema, assetIdSchema, id045d22Schema])

const externalSourcedf9b11Schema = z.string()

const externalSourceeb04b9Schema = z.union([
  externalSourcedf9b11Schema,
  assetIdSchema,
  id045d22Schema,
])

const isActive8f30a3Schema = z.boolean()

const descriptionHtml92a7e9Schema = z.string()

const idc6ba9cSchema = z.string()

const name55c8feSchema = z.string()

const description1faa98Schema = z.string()

const timezonec2812eSchema = z.string()

const ownedById907ebbSchema = z.string()

const sortOrder74b257Schema = z.number()

const logoPropsb439a5Schema = z.record(z.string(), z.json())

const createdAt8a8d4fSchema = z.string()

const createdByIdde9d3fSchema = z.string()

const estimateIdSchema = z.string()

const color3938eeSchema = z.string()

const startDate43e866Schema = z.string()

const priority0d388cSchema = z.string()

const stateIdddfc84Schema = z.string()

const workItemIdSchema = z.string()

const id018dceSchema = z.string()

const description96165cSchema = z.string()

const color880284Schema = z.string()

const sortOrder56bb0aSchema = z.number()

const createdAta2b7a6Schema = z.string()

const targetDate7b0ab1Schema = z.string()

const titlef754b4Schema = z.string()

const ida3c0e8Schema = z.string()

const descriptionc3d3ebSchema = z.string()

const status2fb7baSchema = z.string()

const memberIdsSchema = z.array(assetIdSchema)

const sortOrderedfb74Schema = z.number()

const createdAteac330Schema = z.string()

const createdByIdc85a02Schema = z.string()

const collectionId856ec9Schema = z.string()

const descriptionStrippedba3b79Schema = z.string()

const isLockedca86cfSchema = z.boolean()

const parentId280851Schema = z.string()

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

const metadatabe6a14Schema = z.string()

const urlc17248Schema = z.string()

const version2a0489Schema = z.string()

const id6acb64Schema = z.string()

const description5b24b0Schema = z.string()

const color742473Schema = z.string()

const groupa33045Schema = z.string()

const sequenced0470fSchema = z.number()

const isDefault91f18aSchema = z.boolean()

const isTriage72bb4aSchema = z.boolean()

const createdAtceca3cSchema = z.string()

const createdById3bca72Schema = z.string()

const assetUrlSchema = z.string()

const attributesd762a0Schema = z.string()

const attributes2ff54bSchema = z.union([attributesd762a0Schema, id045d22Schema])

const contentTypeSchema = z.string()

const isUploadedb45807Schema = z.boolean()

const sizec6a674Schema = z.number()

const size422d69Schema = z.union([sizec6a674Schema, access644595Schema])

const scopesSchema = z.array(assetIdSchema)

const idddc529Schema = z.string()

const workItemIda2fc32Schema = z.string()

const commentHtml2d6efcSchema = z.string()

const commentStripped14f41eSchema = z.string()

const accessc9a263Schema = z.string()

const createdAt899c85Schema = z.string()

const idb23e78Schema = z.string()

const name6f7b53Schema = z.string()

const sequenceIdfb3d8dSchema = z.number()

const prioritydca6ceSchema = z.string()

const stateId55c66bSchema = z.string()

const assigneeIdsSchema = z.array(assetIdSchema)

const labelIds958cbcSchema = z.array(assetIdSchema)

const isDraft88b48cSchema = z.boolean()

const createdAt083e6eSchema = z.string()

const customFields9c1322Schema = z.union([logoPropsb439a5Schema, id045d22Schema])

const assigneesItemSchema = z.object({
  id: assetIdSchema.optional(),
  display_name: assetIdSchema.optional(),
  avatar_url: cycle883343Schema.optional(),
  email: assetIdSchema.optional(),
})

const assigneese6f198Schema = z.array(assigneesItemSchema)

const cycle5e8355Schema = z.union([logoProps44136fSchema, id045d22Schema])

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

const ownedBy4be915Schema = z.union([assetIdSchema, userLiteSchema, id045d22Schema])

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
  parent: z.union([parentIdSchema, settings43c814Schema]).optional(),
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

const v1UserRelationSchema = z.union([createdBy94a812Schema, userLiteSchema])

const v1WorkspaceRelationSchema = z.union([
  workspace8d2899Schema,
  z.object({
    id: idSchema.optional(),
    name: nameSchema.optional(),
    slug: assetIdSchema.optional(),
  }),
])

const v1ProjectRelationSchema = z.union([
  project0bf380Schema,
  z.object({
    id: idSchema.optional(),
    identifier: identifierSchema.optional(),
    name: nameSchema.optional(),
    cover_image: coverImageSchema.optional(),
    icon_prop: iconPropSchema.optional(),
    emoji: emojiSchema.optional(),
    description: descriptionSchema.optional(),
    cover_image_url: coverImageUrlSchema.optional(),
    archived_at: archivedAtSchema.optional(),
  }),
])

const v1ParentRelationSchema = z.union([
  parent6f1635Schema,
  z.object({
    id: idSchema.optional(),
    sequence_id: sequenceIdSchema.optional(),
    project_id: projectIdSchema.optional(),
  }),
])

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
  created_by: v1UserRelationSchema.optional(),
  updated_by: v1UserRelationSchema.optional(),
  workspace: v1WorkspaceRelationSchema.optional(),
  project: v1ProjectRelationSchema.optional(),
  parent: v1ParentRelationSchema.optional(),
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

const name7b6775Schema = z.union([name55c8feSchema, id045d22Schema])

const description264bddSchema = z.union([description1faa98Schema, id045d22Schema])

const timezonebabd9dSchema = z.union([timezonec2812eSchema, id045d22Schema])

const ownedById73259eSchema = z.union([ownedById907ebbSchema, id045d22Schema])

const sortOrderf80fa8Schema = z.union([sortOrder74b257Schema, access644595Schema, id045d22Schema])

const createdAt1e01c0Schema = z.union([createdAt8a8d4fSchema, id045d22Schema])

const createdById8acf40Schema = z.union([createdByIdde9d3fSchema, id045d22Schema])

const planeV2Cycles966cb3Schema = z.object({
  id: idc6ba9cSchema.optional(),
  name: name7b6775Schema.optional(),
  description: description264bddSchema.optional(),
  start_date: cycle883343Schema.optional(),
  end_date: cycle883343Schema.optional(),
  timezone: timezonebabd9dSchema.optional(),
  owned_by_id: ownedById73259eSchema.optional(),
  sort_order: sortOrderf80fa8Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt1e01c0Schema.optional(),
  created_by_id: createdById8acf40Schema.optional(),
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

const namea303bdSchema = z.union([name55c8feSchema, id045d22Schema, nameeb0f45Schema])

const descriptionf16dc8Schema = z.union([description1faa98Schema, id045d22Schema, assetIdSchema])

const timezone56a981Schema = z.union([timezonec2812eSchema, id045d22Schema, assetIdSchema])

const sortOrder5313d3Schema = z.union([
  sortOrder74b257Schema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const createdAt5d5af9Schema = z.union([createdAt8a8d4fSchema, id045d22Schema, assetIdSchema])

const ownedBy18e538Schema = z.union([logoPropsb439a5Schema, id045d22Schema, assetIdSchema])

export const planeV2Cycles2e33f2Schema = z.object({
  id: idb26c2bSchema.optional(),
  name: namea303bdSchema.optional(),
  description: descriptionf16dc8Schema.optional(),
  start_date: cycle883343Schema.optional(),
  end_date: cycle883343Schema.optional(),
  timezone: timezone56a981Schema.optional(),
  owned_by_id: ownedById73259eSchema.optional(),
  sort_order: sortOrder5313d3Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAt5d5af9Schema.optional(),
  created_by_id: createdById8acf40Schema.optional(),
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

const dataef851fSchema = z.array(planeV2Cycles966cb3Schema)

export const planeV2V2ListCyclesresultSchema = z.object({
  data: dataef851fSchema.optional(),
  next: previousSchema.optional(),
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

const description81a4a1Schema = z.union([description96165cSchema, id045d22Schema])

const colord2197fSchema = z.union([color880284Schema, id045d22Schema])

const sortOrder962a5fSchema = z.union([sortOrder56bb0aSchema, access644595Schema, id045d22Schema])

const createdAtfef42bSchema = z.union([createdAta2b7a6Schema, id045d22Schema])

const planeV2Labels8dd739Schema = z.object({
  id: id018dceSchema.optional(),
  name: name7b6775Schema.optional(),
  description: description81a4a1Schema.optional(),
  color: colord2197fSchema.optional(),
  sort_order: sortOrder962a5fSchema.optional(),
  parent_id: cycle883343Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAtfef42bSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
})

const id85f016Schema = z.union([id018dceSchema, assetIdSchema, id045d22Schema])

const descriptioncbdb73Schema = z.union([description96165cSchema, id045d22Schema, assetIdSchema])

const colorc6ce7eSchema = z.union([color880284Schema, id045d22Schema, assetIdSchema])

const sortOrderc6eb88Schema = z.union([
  sortOrder56bb0aSchema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const createdAtfe92f6Schema = z.union([createdAta2b7a6Schema, id045d22Schema, assetIdSchema])

export const planeV2Labelseef21eSchema = z.object({
  id: id85f016Schema.optional(),
  name: namea303bdSchema.optional(),
  description: descriptioncbdb73Schema.optional(),
  color: colorc6ce7eSchema.optional(),
  sort_order: sortOrderc6eb88Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAtfe92f6Schema.optional(),
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

const data869439Schema = z.array(planeV2Labels8dd739Schema)

export const planeV2V2ListLabelsresultSchema = z.object({
  data: data869439Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const description40fc6fSchema = z.union([descriptionc3d3ebSchema, id045d22Schema])

const statusac95b5Schema = z.union([status2fb7baSchema, id045d22Schema])

const memberIds6b1a28Schema = z.union([memberIdsSchema, id045d22Schema])

const sortOrder4dad81Schema = z.union([sortOrderedfb74Schema, id045d22Schema])

const createdAt0a6087Schema = z.union([createdAteac330Schema, id045d22Schema])

const createdById4849faSchema = z.union([createdByIdc85a02Schema, id045d22Schema])

const membersef32d2Schema = z.array(logoPropsb439a5Schema)

const planeV2Modules05d650Schema = z.object({
  id: ida3c0e8Schema.optional(),
  name: name7b6775Schema.optional(),
  description: description40fc6fSchema.optional(),
  status: statusac95b5Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  lead_id: cycle883343Schema.optional(),
  member_ids: memberIds6b1a28Schema.optional(),
  sort_order: sortOrder4dad81Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt0a6087Schema.optional(),
  created_by_id: createdById4849faSchema.optional(),
  lead: customFields9c1322Schema.optional(),
  members: membersef32d2Schema.optional(),
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

const description1bdc8eSchema = z.union([descriptionc3d3ebSchema, id045d22Schema, assetIdSchema])

const status379282Schema = z.union([status2fb7baSchema, id045d22Schema, statusd21fa3Schema])

const sortOrderfc43faSchema = z.union([
  sortOrderedfb74Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const createdAt643042Schema = z.union([createdAteac330Schema, id045d22Schema, assetIdSchema])

const membersItemSchema = z.union([logoPropsb439a5Schema, assetIdSchema])

const membersc6e95cSchema = z.array(membersItemSchema)

export const planeV2Modules939f54Schema = z.object({
  id: id492c8cSchema.optional(),
  name: namea303bdSchema.optional(),
  description: description1bdc8eSchema.optional(),
  status: status379282Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  lead_id: cycle883343Schema.optional(),
  member_ids: memberIds6b1a28Schema.optional(),
  sort_order: sortOrderfc43faSchema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt643042Schema.optional(),
  created_by_id: createdById4849faSchema.optional(),
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

const data160787Schema = z.array(planeV2Modules05d650Schema)

export const planeV2V2ListModulesresultSchema = z.object({
  data: data160787Schema.optional(),
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

const module66a93eSchema = z.union([moduleLiteab5dabSchema, id045d22Schema])

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

const access6f79beSchema = z.union([access97d6dbSchema, id045d22Schema, sortOrderdde3e5Schema])

const collectionId827831Schema = z.union([collectionId856ec9Schema, id045d22Schema])

const color085fc1Schema = z.union([color3938eeSchema, id045d22Schema])

const createdAt124fb5Schema = z.union([createdAt50e5d2Schema, id045d22Schema])

const createdByIde4947aSchema = z.union([createdByIdSchema, id045d22Schema])

const descriptionHtml855111Schema = z.union([descriptionHtml92a7e9Schema, id045d22Schema])

const descriptionStripped19310dSchema = z.union([descriptionStrippedba3b79Schema, id045d22Schema])

const externalId8f6a33Schema = z.union([externalIdba2ed6Schema, id045d22Schema])

const externalSourcef69ad5Schema = z.union([externalSourcedf9b11Schema, id045d22Schema])

const isGlobald434d4Schema = z.union([isGlobal48e7dfSchema, id045d22Schema])

const isLockede7e100Schema = z.union([isLockedca86cfSchema, id045d22Schema])

const namee5ba7bSchema = z.union([namef3ca52Schema, id045d22Schema])

const ownedById8d6a13Schema = z.union([ownedById53bb5aSchema, id045d22Schema])

const parentIdf82ccaSchema = z.union([parentId280851Schema, id045d22Schema])

const sortOrder28ccbdSchema = z.union([sortOrder7c3a9eSchema, access644595Schema, id045d22Schema])

const planeV2ProjectPages794a8aSchema = z.object({
  access: access6f79beSchema.optional(),
  archived_at: cycle883343Schema.optional(),
  collection_id: collectionId827831Schema.optional(),
  color: color085fc1Schema.optional(),
  created_at: createdAt124fb5Schema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  description_html: descriptionHtml855111Schema.optional(),
  description_stripped: descriptionStripped19310dSchema.optional(),
  external_id: externalId8f6a33Schema.optional(),
  external_source: externalSourcef69ad5Schema.optional(),
  id: id35193dSchema.optional(),
  is_global: isGlobald434d4Schema.optional(),
  is_locked: isLockede7e100Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  name: namee5ba7bSchema.optional(),
  owned_by_id: ownedById8d6a13Schema.optional(),
  parent_id: parentIdf82ccaSchema.optional(),
  sort_order: sortOrder28ccbdSchema.optional(),
  view_props: viewProps8d74f6Schema.optional(),
  owned_by: customFields9c1322Schema.optional(),
  parent: customFields9c1322Schema.optional(),
})

const accessea8b8eSchema = z.union([
  access97d6dbSchema,
  id045d22Schema,
  sortOrderdde3e5Schema,
  access644595Schema,
])

const collectionId6c8c33Schema = z.union([collectionId856ec9Schema, id045d22Schema, assetIdSchema])

const colorc5d864Schema = z.union([color3938eeSchema, id045d22Schema, assetIdSchema])

const createdAt44295aSchema = z.union([createdAt50e5d2Schema, id045d22Schema, assetIdSchema])

const descriptionHtml96b8d9Schema = z.union([
  descriptionHtml92a7e9Schema,
  id045d22Schema,
  assetIdSchema,
])

const descriptionStrippede3903aSchema = z.union([
  descriptionStrippedba3b79Schema,
  id045d22Schema,
  assetIdSchema,
])

const id835e8aSchema = z.union([id35193dSchema, assetIdSchema, id045d22Schema])

const isLocked9137e7Schema = z.union([isLockedca86cfSchema, id045d22Schema, hasPages8e2bc3Schema])

const name319da8Schema = z.union([namef3ca52Schema, id045d22Schema, assetIdSchema])

const parentId66217aSchema = z.union([parentId280851Schema, id045d22Schema, assetIdSchema])

export const planeV2ProjectPages0bb396Schema = z.object({
  access: accessea8b8eSchema.optional(),
  archived_at: cycle883343Schema.optional(),
  collection_id: collectionId6c8c33Schema.optional(),
  color: colorc5d864Schema.optional(),
  created_at: createdAt44295aSchema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  description_html: descriptionHtml96b8d9Schema.optional(),
  description_stripped: descriptionStrippede3903aSchema.optional(),
  external_id: externalId8f6a33Schema.optional(),
  external_source: externalSourcef69ad5Schema.optional(),
  id: id835e8aSchema.optional(),
  is_global: isGlobald434d4Schema.optional(),
  is_locked: isLocked9137e7Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  name: name319da8Schema.optional(),
  owned_by_id: ownedById8d6a13Schema.optional(),
  parent_id: parentId66217aSchema.optional(),
  sort_order: sortOrder28ccbdSchema.optional(),
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

export const planeV2ProjectPages728fd0Schema = z.object({
  access: accessea8b8eSchema.optional(),
  archived_at: cycle883343Schema.optional(),
  collection_id: collectionId6c8c33Schema.optional(),
  color: colorc5d864Schema.optional(),
  created_at: createdAt44295aSchema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  description_html: descriptionHtml96b8d9Schema.optional(),
  description_stripped: descriptionStrippede3903aSchema.optional(),
  external_id: externalId8f6a33Schema.optional(),
  external_source: externalSourcef69ad5Schema.optional(),
  id: id835e8aSchema.optional(),
  is_global: isGlobald434d4Schema.optional(),
  is_locked: isLocked9137e7Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  name: name319da8Schema.optional(),
  owned_by_id: ownedById8d6a13Schema.optional(),
  parent_id: parentId66217aSchema.optional(),
  sort_order: sortOrder28ccbdSchema.optional(),
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

const data3fb521Schema = z.array(planeV2ProjectPages794a8aSchema)

export const planeV2V2ListProjectPagesresultSchema = z.object({
  data: data3fb521Schema.optional(),
  next: previousSchema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const archiveInf3737fSchema = z.union([
  archiveIn875827Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const closeIn62b612Schema = z.union([closeIn4103eeSchema, id045d22Schema, sortOrderdde3e5Schema])

const coverImage7b4bb5Schema = z.union([coverImage1c99d0Schema, id045d22Schema])

const coverImageUrldc35eeSchema = z.union([coverImageUrl4a1253Schema, id045d22Schema])

const cycleView0167afSchema = z.union([cycleView2b2a92Schema, id045d22Schema])

const defaultAssigneeId053282Schema = z.union([defaultAssigneeIdSchema, id045d22Schema])

const defaultStateIdd87cd6Schema = z.union([defaultStateIdSchema, id045d22Schema])

const description6d06e5Schema = z.union([description36d05fSchema, id045d22Schema])

const emojic5f22cSchema = z.union([emoji40b5b7Schema, id045d22Schema])

const estimateId113377Schema = z.union([estimateIdSchema, id045d22Schema])

const guestViewAllFeatures693067Schema = z.union([guestViewAllFeatures786ecfSchema, id045d22Schema])

const iconProp8c92a6Schema = z.union([settings43c814Schema, iconProp7d18beSchema, id045d22Schema])

const identifier2a3f6dSchema = z.union([identifier74e88fSchema, id045d22Schema])

const intakeView5ec43cSchema = z.union([intakeViewadf501Schema, id045d22Schema])

const isIssueTypeEnabled2f9c2cSchema = z.union([isIssueTypeEnabled0467a8Schema, id045d22Schema])

const isTimeTrackingEnabled4fd05bSchema = z.union([
  isTimeTrackingEnabledc98808Schema,
  id045d22Schema,
])

const issueViewsView2688d2Schema = z.union([issueViewsView9a6da4Schema, id045d22Schema])

const moduleView079009Schema = z.union([moduleViewff7a9cSchema, id045d22Schema])

const network04b566Schema = z.union([networkab7e29Schema, id045d22Schema, sortOrderdde3e5Schema])

const pageViewd76986Schema = z.union([pageView884451Schema, id045d22Schema])

const priority487697Schema = z.union([priority0d388cSchema, id045d22Schema])

const projectLeadIdd4dea5Schema = z.union([projectLeadIdSchema, id045d22Schema])

const startDate33401bSchema = z.union([startDate43e866Schema, id045d22Schema])

const stateIdb36d1cSchema = z.union([stateIdddfc84Schema, id045d22Schema])

const targetDate3e40fbSchema = z.union([targetDate7b0ab1Schema, id045d22Schema])

const timezone700df1Schema = z.union([timezone852348Schema, id045d22Schema])

const planeV2Projects514a97Schema = z.object({
  archive_in: archiveInf3737fSchema.optional(),
  archived_at: cycle883343Schema.optional(),
  close_in: closeIn62b612Schema.optional(),
  cover_image: coverImage7b4bb5Schema.optional(),
  cover_image_url: coverImageUrldc35eeSchema.optional(),
  created_at: createdAt124fb5Schema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  cycle_view: cycleView0167afSchema.optional(),
  default_assignee_id: defaultAssigneeId053282Schema.optional(),
  default_state_id: defaultStateIdd87cd6Schema.optional(),
  description: description6d06e5Schema.optional(),
  emoji: emojic5f22cSchema.optional(),
  estimate_id: estimateId113377Schema.optional(),
  external_id: externalId8f6a33Schema.optional(),
  external_source: externalSourcef69ad5Schema.optional(),
  guest_view_all_features: guestViewAllFeatures693067Schema.optional(),
  icon_prop: iconProp8c92a6Schema.optional(),
  id: id35193dSchema.optional(),
  identifier: identifier2a3f6dSchema.optional(),
  intake_view: intakeView5ec43cSchema.optional(),
  is_issue_type_enabled: isIssueTypeEnabled2f9c2cSchema.optional(),
  is_time_tracking_enabled: isTimeTrackingEnabled4fd05bSchema.optional(),
  issue_views_view: issueViewsView2688d2Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  module_view: moduleView079009Schema.optional(),
  name: namee5ba7bSchema.optional(),
  network: network04b566Schema.optional(),
  page_view: pageViewd76986Schema.optional(),
  priority: priority487697Schema.optional(),
  project_lead_id: projectLeadIdd4dea5Schema.optional(),
  start_date: startDate33401bSchema.optional(),
  state_id: stateIdb36d1cSchema.optional(),
  target_date: targetDate3e40fbSchema.optional(),
  timezone: timezone700df1Schema.optional(),
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

const defaultAssignee13325eSchema = z.union([assetIdSchema, id045d22Schema])

const projectLeadaf8c35Schema = z.union([assetIdSchema, id045d22Schema])

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

const archiveIn16be97Schema = z.union([
  archiveIn875827Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
  access644595Schema,
])

const closeIn00d0adSchema = z.union([
  closeIn4103eeSchema,
  id045d22Schema,
  sortOrderdde3e5Schema,
  access644595Schema,
])

const coverImage5a836dSchema = z.union([coverImage1c99d0Schema, id045d22Schema, assetIdSchema])

const coverImageUrl859208Schema = z.union([
  coverImageUrl4a1253Schema,
  id045d22Schema,
  assetIdSchema,
])

const cycleView0093abSchema = z.union([cycleView2b2a92Schema, id045d22Schema, hasPages8e2bc3Schema])

const descriptiond05b9dSchema = z.union([description36d05fSchema, id045d22Schema, assetIdSchema])

const emojifc2580Schema = z.union([emoji40b5b7Schema, id045d22Schema, assetIdSchema])

const externalId25f63eSchema = z.union([externalIdba2ed6Schema, id045d22Schema, assetIdSchema])

const externalSource7a8115Schema = z.union([
  externalSourcedf9b11Schema,
  id045d22Schema,
  assetIdSchema,
])

const guestViewAllFeaturesf6b081Schema = z.union([
  guestViewAllFeatures786ecfSchema,
  id045d22Schema,
  hasPages8e2bc3Schema,
])

const iconProp030587Schema = z.union([
  settings43c814Schema,
  iconProp7d18beSchema,
  id045d22Schema,
  logoProps44136fSchema,
])

const identifier0f5278Schema = z.union([identifier74e88fSchema, id045d22Schema, identifierSchema])

const intakeView6d12d9Schema = z.union([
  intakeViewadf501Schema,
  id045d22Schema,
  hasPages8e2bc3Schema,
])

const isIssueTypeEnabled308732Schema = z.union([
  isIssueTypeEnabled0467a8Schema,
  id045d22Schema,
  hasPages8e2bc3Schema,
])

const isTimeTrackingEnabled2042cfSchema = z.union([
  isTimeTrackingEnabledc98808Schema,
  id045d22Schema,
  hasPages8e2bc3Schema,
])

const issueViewsViewe0f414Schema = z.union([
  issueViewsView9a6da4Schema,
  id045d22Schema,
  hasPages8e2bc3Schema,
])

const moduleViewd070ffSchema = z.union([
  moduleViewff7a9cSchema,
  id045d22Schema,
  hasPages8e2bc3Schema,
])

const namee6202eSchema = z.union([namef3ca52Schema, id045d22Schema, nameeb0f45Schema])

const networka6ca68Schema = z.union([
  networkab7e29Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
  access644595Schema,
])

const pageViewf788c4Schema = z.union([pageView884451Schema, id045d22Schema, hasPages8e2bc3Schema])

const priorityae12bfSchema = z.union([priority0d388cSchema, id045d22Schema, assetIdSchema])

const timezone620611Schema = z.union([timezone852348Schema, id045d22Schema, timezone467abfSchema])

export const planeV2Projectsfac84fSchema = z.object({
  archive_in: archiveIn16be97Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  close_in: closeIn00d0adSchema.optional(),
  cover_image: coverImage5a836dSchema.optional(),
  cover_image_url: coverImageUrl859208Schema.optional(),
  created_at: createdAt44295aSchema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  cycle_view: cycleView0093abSchema.optional(),
  default_assignee_id: defaultAssigneeId053282Schema.optional(),
  default_state_id: defaultStateIdd87cd6Schema.optional(),
  description: descriptiond05b9dSchema.optional(),
  emoji: emojifc2580Schema.optional(),
  estimate_id: estimateId113377Schema.optional(),
  external_id: externalId25f63eSchema.optional(),
  external_source: externalSource7a8115Schema.optional(),
  guest_view_all_features: guestViewAllFeaturesf6b081Schema.optional(),
  icon_prop: iconProp030587Schema.optional(),
  id: id835e8aSchema.optional(),
  identifier: identifier0f5278Schema.optional(),
  intake_view: intakeView6d12d9Schema.optional(),
  is_issue_type_enabled: isIssueTypeEnabled308732Schema.optional(),
  is_time_tracking_enabled: isTimeTrackingEnabled2042cfSchema.optional(),
  issue_views_view: issueViewsViewe0f414Schema.optional(),
  logo_props: viewProps8d74f6Schema.optional(),
  module_view: moduleViewd070ffSchema.optional(),
  name: namee6202eSchema.optional(),
  network: networka6ca68Schema.optional(),
  page_view: pageViewf788c4Schema.optional(),
  priority: priorityae12bfSchema.optional(),
  project_lead_id: projectLeadIdd4dea5Schema.optional(),
  start_date: startDate33401bSchema.optional(),
  state_id: stateIdb36d1cSchema.optional(),
  target_date: targetDate3e40fbSchema.optional(),
  timezone: timezone620611Schema.optional(),
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

const planeV2Counts3ffeeeSchema = z.object({
  modules: sortOrderdde3e5Schema.optional(),
  work_item_types: sortOrderdde3e5Schema.optional(),
  issues: sortOrderdde3e5Schema.optional(),
  members: sortOrderdde3e5Schema.optional(),
  work_item_properties: sortOrderdde3e5Schema.optional(),
  states: sortOrderdde3e5Schema.optional(),
  intakes: sortOrderdde3e5Schema.optional(),
  cycles: sortOrderdde3e5Schema.optional(),
  labels: sortOrderdde3e5Schema.optional(),
  pages: sortOrderdde3e5Schema.optional(),
})

export const planeV2V2GetProjectSummaryresultSchema = z.object({
  counts: planeV2Counts3ffeeeSchema.optional(),
  id: assetIdSchema.optional(),
  identifier: assetIdSchema.optional(),
  name: assetIdSchema.optional(),
})

const data197ad8Schema = z.array(planeV2Projects514a97Schema)

export const planeV2V2ListProjectsresultSchema = z.object({
  data: data197ad8Schema.optional(),
  next: previousSchema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const description92bd53Schema = z.union([description5b24b0Schema, id045d22Schema])

const color9c6d3dSchema = z.union([color742473Schema, id045d22Schema])

const groupc9b3a3Schema = z.union([groupa33045Schema, id045d22Schema])

const sequence67dd7fSchema = z.union([sequenced0470fSchema, access644595Schema, id045d22Schema])

const isDefaultf17c77Schema = z.union([isDefault91f18aSchema, id045d22Schema])

const isTriage87ad48Schema = z.union([isTriage72bb4aSchema, id045d22Schema])

const createdAtf908e0Schema = z.union([createdAtceca3cSchema, id045d22Schema])

const createdById01b651Schema = z.union([createdById3bca72Schema, id045d22Schema])

const planeV2States715b3eSchema = z.object({
  id: id6acb64Schema.optional(),
  name: name7b6775Schema.optional(),
  description: description92bd53Schema.optional(),
  color: color9c6d3dSchema.optional(),
  group: groupc9b3a3Schema.optional(),
  sequence: sequence67dd7fSchema.optional(),
  is_default: isDefaultf17c77Schema.optional(),
  is_triage: isTriage87ad48Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAtf908e0Schema.optional(),
  created_by_id: createdById01b651Schema.optional(),
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

const description3595caSchema = z.union([description5b24b0Schema, id045d22Schema, assetIdSchema])

const colorb20fe7Schema = z.union([color742473Schema, id045d22Schema, colorbba70bSchema])

const group9d61b8Schema = z.union([groupa33045Schema, id045d22Schema, groupb0d31eSchema])

const sequence9c729cSchema = z.union([
  sequenced0470fSchema,
  access644595Schema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const isTriagec3814bSchema = z.union([isTriage72bb4aSchema, id045d22Schema, hasPages8e2bc3Schema])

const createdAtc25f34Schema = z.union([createdAtceca3cSchema, id045d22Schema, assetIdSchema])

export const planeV2Statesd0d9cbSchema = z.object({
  id: id0104b0Schema.optional(),
  name: namea303bdSchema.optional(),
  description: description3595caSchema.optional(),
  color: colorb20fe7Schema.optional(),
  group: group9d61b8Schema.optional(),
  sequence: sequence9c729cSchema.optional(),
  is_default: isDefaultf17c77Schema.optional(),
  is_triage: isTriagec3814bSchema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  created_at: createdAtc25f34Schema.optional(),
  created_by_id: createdById01b651Schema.optional(),
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

const data0c6eebSchema = z.array(planeV2States715b3eSchema)

export const planeV2V2ListStatesresultSchema = z.object({
  data: data0c6eebSchema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const contentType354080Schema = z.union([contentTypeSchema, id045d22Schema])

const isActive7bda94Schema = z.union([isActive8f30a3Schema, id045d22Schema])

const scopes1041c9Schema = z.union([scopesSchema, id045d22Schema])

const urlcab79dSchema = z.union([urlc17248Schema, id045d22Schema])

const versiondb9f04Schema = z.union([version2a0489Schema, id045d22Schema])

export const planeV2Webhooksbfebf2Schema = z.object({
  content_type: contentType354080Schema.optional(),
  created_at: createdAt124fb5Schema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  id: id35193dSchema.optional(),
  is_active: isActive7bda94Schema.optional(),
  name: namee5ba7bSchema.optional(),
  scopes: scopes1041c9Schema.optional(),
  url: urlcab79dSchema.optional(),
  version: versiondb9f04Schema.optional(),
  secret_key: assetIdSchema.optional(),
})

export const planeV2Webhooksa201e9Schema = z.object({
  content_type: contentType354080Schema.optional(),
  created_at: createdAt124fb5Schema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  id: id35193dSchema.optional(),
  is_active: isActive7bda94Schema.optional(),
  name: namee5ba7bSchema.optional(),
  scopes: scopes1041c9Schema.optional(),
  url: urlcab79dSchema.optional(),
  version: versiondb9f04Schema.optional(),
})

const data239d3cSchema = z.array(planeV2Webhooksa201e9Schema)

export const planeV2V2ListWebhooksresultSchema = z.object({
  data: data239d3cSchema.optional(),
  next: previousSchema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const isActive94c709Schema = z.union([hasPages8e2bc3Schema, id045d22Schema])

const scopes6811caSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

export const planeV2V2RegenerateWebhookSecretresultSchema = z.object({
  content_type: cycle883343Schema.optional(),
  created_at: cycle883343Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  id: assetIdSchema.optional(),
  is_active: isActive94c709Schema.optional(),
  name: cycle883343Schema.optional(),
  scopes: scopes6811caSchema.optional(),
  secret_key: assetIdSchema.optional(),
  url: cycle883343Schema.optional(),
  version: cycle883343Schema.optional(),
})

const assetUrlec2eacSchema = z.union([assetUrlSchema, id045d22Schema])

const isUploadedef2982Schema = z.union([isUploadedb45807Schema, id045d22Schema])

const size43e2f4Schema = z.union([sizec6a674Schema, access644595Schema, id045d22Schema])

const workItemId1fb0c4Schema = z.union([workItemIdSchema, id045d22Schema])

export const planeV2WorkItemAttachmentsee0dadSchema = z.object({
  asset_url: assetUrlec2eacSchema.optional(),
  attributes: viewProps8d74f6Schema.optional(),
  content_type: contentType354080Schema.optional(),
  created_at: createdAt124fb5Schema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  external_id: externalId8f6a33Schema.optional(),
  external_source: externalSourcef69ad5Schema.optional(),
  id: id35193dSchema.optional(),
  is_uploaded: isUploadedef2982Schema.optional(),
  name: namee5ba7bSchema.optional(),
  size: size43e2f4Schema.optional(),
  work_item_id: workItemId1fb0c4Schema.optional(),
})

const assetIdefc9b8Schema = z.string()

const uploadDataff32a4Schema = z.record(z.string(), z.json())

const assetUrl9cac7fSchema = z.union([assetIdSchema, id045d22Schema])

const contentType24c2cdSchema = z.union([assetIdSchema, id045d22Schema])

const createdAtaf1286Schema = z.string()

const createdById3197f9Schema = z.union([assetIdSchema, id045d22Schema])

const workItemId453685Schema = z.union([assetIdSchema, id045d22Schema])

const sizef7df58Schema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const storageMetadata582a13Schema = z.union([
  logoProps44136fSchema,
  id045d22Schema,
  progressSnapshot9e2fcdSchema,
])

const userb09253Schema = z.union([assetIdSchema, id045d22Schema])

const uploadDatad3b3dcSchema = z.union([uploadDataff32a4Schema, uploadData016c9cSchema])

const idb5de88Schema = z.union([ide04262Schema, assetIdSchema, id045d22Schema])

const createdAtdb996dSchema = z.union([createdAtaf1286Schema, id045d22Schema, assetIdSchema])

const sizea2e43eSchema = z.union([sortOrderdde3e5Schema, id045d22Schema, access644595Schema])

const workItemAttachmentd70211Schema = z.object({
  id: idb5de88Schema.optional(),
  asset_url: assetUrl9cac7fSchema.optional(),
  attributes: viewProps8d74f6Schema.optional(),
  content_type: contentType24c2cdSchema.optional(),
  created_at: createdAtdb996dSchema.optional(),
  created_by_id: createdById3197f9Schema.optional(),
  external_id: externalIdSchema.optional(),
  external_source: externalSourceSchema.optional(),
  is_uploaded: isUploadedSchema.optional(),
  name: nameSchema.optional(),
  size: sizea2e43eSchema.optional(),
  work_item_id: workItemId453685Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  asset: assetSchema.optional(),
  entity_type: entityTypeSchema.optional(),
  entity_identifier: entityIdentifierSchema.optional(),
  is_deleted: isDeletedSchema.optional(),
  is_archived: isArchivedSchema.optional(),
  storage_metadata: storageMetadata582a13Schema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  user: userb09253Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  draft_issue: draftIssueSchema.optional(),
  project: project0bf380Schema.optional(),
  issue: issueSchema.optional(),
  comment: commentSchema.optional(),
  page: pageSchema.optional(),
  deleted_by: cycle5e8355Schema.optional(),
})

export const planeV2WorkItemAttachments95c9d1Schema = z.object({
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
  asset_id: assetIdefc9b8Schema.optional(),
  upload_data: uploadDatad3b3dcSchema.optional(),
  attachment: workItemAttachmentd70211Schema.optional(),
  detail: detailSchema.optional(),
})

const dataedffc3Schema = z.array(planeV2WorkItemAttachmentsee0dadSchema)

export const planeV2V2ListAttachmentsresultSchema = z.object({
  data: dataedffc3Schema.optional(),
  next: previousSchema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

const storageMetadatac2b887Schema = z.object({
  ETag: assetIdSchema.optional(),
  Metadata: progressSnapshot9e2fcdSchema.optional(),
  ContentType: assetIdSchema.optional(),
  LastModified: assetIdSchema.optional(),
  ContentLength: sortOrderdde3e5Schema.optional(),
})

const storageMetadata8e9359Schema = z.union([
  logoProps44136fSchema,
  id045d22Schema,
  storageMetadatac2b887Schema,
])

export const workItemAttachment28f0baSchema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  attributes: viewProps8d74f6Schema.optional(),
  asset: assetSchema.optional(),
  entity_type: entityTypeSchema.optional(),
  entity_identifier: entityIdentifierSchema.optional(),
  is_deleted: isDeletedSchema.optional(),
  is_archived: isArchivedSchema.optional(),
  external_id: externalIdSchema.optional(),
  external_source: externalSourceSchema.optional(),
  size: sizef7df58Schema.optional(),
  is_uploaded: isUploadedSchema.optional(),
  storage_metadata: storageMetadata8e9359Schema.optional(),
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
  deleted_by: cycle5e8355Schema.optional(),
})

const workItemIdbeefdcSchema = z.union([workItemIda2fc32Schema, id045d22Schema])

const commentHtml99cbdfSchema = z.union([commentHtml2d6efcSchema, id045d22Schema])

const commentStrippede516f4Schema = z.union([commentStripped14f41eSchema, id045d22Schema])

const access26d890Schema = z.union([accessc9a263Schema, id045d22Schema])

const createdAt82bf57Schema = z.union([createdAt899c85Schema, id045d22Schema])

const planeV2WorkItemComments7f97f6Schema = z.object({
  id: idddc529Schema.optional(),
  work_item_id: workItemIdbeefdcSchema.optional(),
  comment_html: commentHtml99cbdfSchema.optional(),
  comment_stripped: commentStrippede516f4Schema.optional(),
  access: access26d890Schema.optional(),
  actor_id: cycle883343Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  edited_at: cycle883343Schema.optional(),
  created_at: createdAt82bf57Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  actor: customFields9c1322Schema.optional(),
})

const actorf9564cSchema = z.union([assetIdSchema, id045d22Schema])

const id1dc427Schema = z.union([idddc529Schema, assetIdSchema, id045d22Schema])

const commentHtmle80f0eSchema = z.union([commentHtml2d6efcSchema, id045d22Schema, assetIdSchema])

const commentStripped9faab8Schema = z.union([
  commentStripped14f41eSchema,
  id045d22Schema,
  assetIdSchema,
])

const accessd463dfSchema = z.union([accessc9a263Schema, id045d22Schema, access4ffefdSchema])

const createdAt0c2869Schema = z.union([createdAt899c85Schema, id045d22Schema, assetIdSchema])

export const planeV2WorkItemComments5af051Schema = z.object({
  id: id1dc427Schema.optional(),
  work_item_id: workItemIdbeefdcSchema.optional(),
  comment_html: commentHtmle80f0eSchema.optional(),
  comment_stripped: commentStripped9faab8Schema.optional(),
  access: accessd463dfSchema.optional(),
  actor_id: cycle883343Schema.optional(),
  external_id: cycle883343Schema.optional(),
  external_source: cycle883343Schema.optional(),
  edited_at: cycle883343Schema.optional(),
  created_at: createdAt0c2869Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
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
  deleted_by: cycle5e8355Schema.optional(),
  is_hidden: hasPages8e2bc3Schema.optional(),
  created_via: cycle5e8355Schema.optional(),
  updated_via: cycle5e8355Schema.optional(),
  hidden_reason: cycle5e8355Schema.optional(),
  hidden_at: cycle5e8355Schema.optional(),
  hidden_by: cycle5e8355Schema.optional(),
  source: cycle5e8355Schema.optional(),
})

const dataa3b4a5Schema = z.array(planeV2WorkItemComments7f97f6Schema)

export const planeV2V2ListCommentsresultSchema = z.object({
  data: dataa3b4a5Schema.optional(),
  next: previousSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemCommenta652feSchema = z.object({
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
  deleted_by: cycle5e8355Schema.optional(),
  is_hidden: hasPages8e2bc3Schema.optional(),
  created_via: cycle5e8355Schema.optional(),
  updated_via: cycle5e8355Schema.optional(),
  hidden_reason: cycle5e8355Schema.optional(),
  hidden_at: cycle5e8355Schema.optional(),
  hidden_by: cycle5e8355Schema.optional(),
  source: cycle5e8355Schema.optional(),
})

const metadata270555Schema = z.union([settings43c814Schema, metadatabe6a14Schema, id045d22Schema])

const title3c72d1Schema = z.union([titlef754b4Schema, id045d22Schema])

const planeV2WorkItemLinks496d44Schema = z.object({
  created_at: createdAt124fb5Schema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  id: id35193dSchema.optional(),
  metadata: metadata270555Schema.optional(),
  title: title3c72d1Schema.optional(),
  url: urlcab79dSchema.optional(),
  work_item_id: workItemId1fb0c4Schema.optional(),
})

const metadataa48923Schema = z.union([
  settings43c814Schema,
  metadatabe6a14Schema,
  id045d22Schema,
  logoProps44136fSchema,
  progressSnapshot9e2fcdSchema,
])

const titleb3da20Schema = z.union([titlef754b4Schema, id045d22Schema, assetIdSchema])

const urlb9b40fSchema = z.union([urlc17248Schema, id045d22Schema, urlSchema])

export const planeV2WorkItemLinksbf8b88Schema = z.object({
  created_at: createdAt44295aSchema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  id: id835e8aSchema.optional(),
  metadata: metadataa48923Schema.optional(),
  title: titleb3da20Schema.optional(),
  url: urlb9b40fSchema.optional(),
  work_item_id: workItemId1fb0c4Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  deleted_by: cycle5e8355Schema.optional(),
})

const name92e185Schema = z.string()

const metadatae42e21Schema = z.object({
  url: assetIdSchema.optional(),
  title: assetIdSchema.optional(),
  favicon: assetIdSchema.optional(),
  favicon_url: cycle5e8355Schema.optional(),
})

const metadatae14892Schema = z.union([logoProps44136fSchema, id045d22Schema, metadatae42e21Schema])

const metadata3e5254Schema = z.union([
  settings43c814Schema,
  metadatabe6a14Schema,
  id045d22Schema,
  logoProps44136fSchema,
  metadatae42e21Schema,
])

export const planeV2WorkItemLinks9c2403Schema = z.object({
  created_at: createdAt44295aSchema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  id: id835e8aSchema.optional(),
  metadata: metadata3e5254Schema.optional(),
  title: titleb3da20Schema.optional(),
  url: urlb9b40fSchema.optional(),
  work_item_id: workItemId1fb0c4Schema.optional(),
  name: name92e185Schema.optional(),
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
  deleted_by: cycle5e8355Schema.optional(),
})

const data0df047Schema = z.array(planeV2WorkItemLinks496d44Schema)

export const planeV2V2ListLinksresultSchema = z.object({
  data: data0df047Schema.optional(),
  next: previousSchema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const workItemLink43e0b0Schema = z.object({
  id: idSchema.optional(),
  created_at: createdAtSchema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  title: titleSchema.optional(),
  url: urlSchema.optional(),
  metadata: metadatae14892Schema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  name: assetIdSchema.optional(),
  deleted_by: cycle5e8355Schema.optional(),
})

export const planeV2WorkItemLinks38dcf4Schema = z.object({
  created_at: createdAt44295aSchema.optional(),
  created_by_id: createdByIde4947aSchema.optional(),
  id: id835e8aSchema.optional(),
  metadata: metadata3e5254Schema.optional(),
  title: titleb3da20Schema.optional(),
  url: urlb9b40fSchema.optional(),
  work_item_id: workItemId1fb0c4Schema.optional(),
  updated_at: updatedAtSchema.optional(),
  deleted_at: deletedAtSchema.optional(),
  created_by: createdBy94a812Schema.optional(),
  updated_by: updatedBy1f6d11Schema.optional(),
  project: project0bf380Schema.optional(),
  workspace: workspace8d2899Schema.optional(),
  issue: issueSchema.optional(),
  deleted_by: cycle5e8355Schema.optional(),
})

const nameeff235Schema = z.union([name6f7b53Schema, id045d22Schema])

const identifier73db85Schema = z.string()

const identifier88c0eaSchema = z.union([identifier73db85Schema, id045d22Schema])

const sequenceIde286f6Schema = z.union([sequenceIdfb3d8dSchema, id045d22Schema])

const priority69905eSchema = z.union([prioritydca6ceSchema, id045d22Schema])

const stateId99d408Schema = z.union([stateId55c66bSchema, id045d22Schema])

const assigneeIdsdfe2c4Schema = z.union([assigneeIdsSchema, id045d22Schema])

const labelIds6b2c72Schema = z.union([labelIds958cbcSchema, id045d22Schema])

const isDraftb1b3d0Schema = z.union([isDraft88b48cSchema, id045d22Schema])

const createdAt7ff034Schema = z.union([createdAt083e6eSchema, id045d22Schema])

const cycleId7c066cSchema = z.union([assetIdSchema, id045d22Schema])

const moduleIdsSchema = z.union([defaultValuecb839fSchema, id045d22Schema])

export const planeV2WorkItems9ed9d6Schema = z.object({
  id: idb23e78Schema.optional(),
  name: nameeff235Schema.optional(),
  identifier: identifier88c0eaSchema.optional(),
  sequence_id: sequenceIde286f6Schema.optional(),
  priority: priority69905eSchema.optional(),
  state_id: stateId99d408Schema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsdfe2c4Schema.optional(),
  label_ids: labelIds6b2c72Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraftb1b3d0Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt7ff034Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: customFields9c1322Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: membersef32d2Schema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
  cycle_id: cycleId7c066cSchema.optional(),
  module_ids: moduleIdsSchema.optional(),
  project_id: projectIdSchema.optional(),
})

const sequenceIde281c0Schema = z.union([
  sequenceIdfb3d8dSchema,
  id045d22Schema,
  sortOrderdde3e5Schema,
])

const moduleIdsItemSchema = z.union([assetIdSchema, logoProps44136fSchema])

const moduleIdsccb225Schema = z.array(moduleIdsItemSchema)

const moduleIds80dc0dSchema = z.union([moduleIdsccb225Schema, id045d22Schema])

export const planeV2WorkItemse09eebSchema = z.object({
  id: idb23e78Schema.optional(),
  name: nameeff235Schema.optional(),
  identifier: identifier88c0eaSchema.optional(),
  sequence_id: sequenceIde281c0Schema.optional(),
  priority: priority69905eSchema.optional(),
  state_id: stateId99d408Schema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsdfe2c4Schema.optional(),
  label_ids: labelIds6b2c72Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraftb1b3d0Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt7ff034Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: membersef32d2Schema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
  project_id: cycle883343Schema.optional(),
  cycle_id: cycle883343Schema.optional(),
  module_ids: moduleIds80dc0dSchema.optional(),
})

const id3b71dcSchema = z.union([idb23e78Schema, assetIdSchema, id045d22Schema])

const name31ecc6Schema = z.union([name6f7b53Schema, id045d22Schema, assetIdSchema])

const sequenceIde56cecSchema = z.union([
  sequenceIdfb3d8dSchema,
  id045d22Schema,
  sortOrderdde3e5Schema,
  access644595Schema,
])

const priorityce8c57Schema = z.union([prioritydca6ceSchema, id045d22Schema, priorityb96bbbSchema])

const isDraftbe6086Schema = z.union([isDraft88b48cSchema, id045d22Schema, hasPages8e2bc3Schema])

const createdAt709d9eSchema = z.union([createdAt083e6eSchema, id045d22Schema, assetIdSchema])

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

export const planeV2WorkItems0f282fSchema = z.object({
  id: id3b71dcSchema.optional(),
  name: name31ecc6Schema.optional(),
  identifier: identifier88c0eaSchema.optional(),
  sequence_id: sequenceIde56cecSchema.optional(),
  priority: priorityce8c57Schema.optional(),
  state_id: stateId99d408Schema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsdfe2c4Schema.optional(),
  label_ids: labelIds6b2c72Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraftbe6086Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt709d9eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  assignees: assigneesb6479cSchema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labels3303c8Schema.optional(),
  modules: membersef32d2Schema.optional(),
  parent: parent848f9cSchema.optional(),
  state: state7f27f1Schema.optional(),
  type: type65a531Schema.optional(),
  project_id: cycle883343Schema.optional(),
  cycle_id: cycle883343Schema.optional(),
  module_ids: moduleIds80dc0dSchema.optional(),
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

export const planeV2WorkItems675283Schema = z.object({
  id: id3b71dcSchema.optional(),
  name: name31ecc6Schema.optional(),
  identifier: identifier88c0eaSchema.optional(),
  sequence_id: sequenceIde56cecSchema.optional(),
  priority: priorityce8c57Schema.optional(),
  state_id: stateId99d408Schema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsdfe2c4Schema.optional(),
  label_ids: labelIds6b2c72Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraftbe6086Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt709d9eSchema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  state: statebb5f68Schema.optional(),
  assignees: assigneese78af7Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsdb08cdSchema.optional(),
  modules: membersef32d2Schema.optional(),
  parent: parent848f9cSchema.optional(),
  type: type65a531Schema.optional(),
  project_id: cycle883343Schema.optional(),
  cycle_id: cycle883343Schema.optional(),
  module_ids: moduleIds80dc0dSchema.optional(),
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

const dataf74a82Schema = z.array(planeV2WorkItemse09eebSchema)

const nextSchema = z.union([access644595Schema, id045d22Schema, sortOrderdde3e5Schema])

const previous55126eSchema = z.union([sortOrderdde3e5Schema, access644595Schema, id045d22Schema])

export const planeV2V2ListWorkItemsresultSchema = z.object({
  data: dataf74a82Schema.optional(),
  next: nextSchema.optional(),
  previous: previous55126eSchema.optional(),
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

const sequenceIde1225bSchema = z.union([
  assetIdSchema,
  sortOrderdde3e5Schema,
  sequenceIdfb3d8dSchema,
  id045d22Schema,
])

const assigneeIdsItemSchema = z.union([defaultValuecb839fSchema, assetIdSchema])

const assigneeIdsd8f4d4Schema = z.array(assigneeIdsItemSchema)

const assigneeIds80f9e7Schema = z.union([assigneeIdsd8f4d4Schema, id045d22Schema])

const labelIds518323Schema = z.array(assigneeIdsItemSchema)

const labelIdsb582f0Schema = z.union([labelIds518323Schema, id045d22Schema])

const moduleIds241605Schema = z.array(assigneeIdsItemSchema)

const moduleIdsc1b38aSchema = z.union([moduleIds241605Schema, id045d22Schema])

const planeV2WorkItems3305dfSchema = z.object({
  id: idb23e78Schema.optional(),
  name: nameeff235Schema.optional(),
  identifier: identifier88c0eaSchema.optional(),
  sequence_id: sequenceIde1225bSchema.optional(),
  priority: priority69905eSchema.optional(),
  state_id: stateId99d408Schema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIds80f9e7Schema.optional(),
  label_ids: labelIdsb582f0Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraftb1b3d0Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt7ff034Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  cycle_id: cycle883343Schema.optional(),
  module_ids: moduleIdsc1b38aSchema.optional(),
  project_id: cycle883343Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: membersef32d2Schema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
})

const datac48c4dSchema = z.array(planeV2WorkItems3305dfSchema)

export const planeV2V2ListWorkspaceWorkItemsresultSchema = z.object({
  data: datac48c4dSchema.optional(),
  next: previousSchema.optional(),
  pagination: planeV2PaginationSchema.optional(),
  previous: previousSchema.optional(),
  total_count: access644595Schema.optional(),
  next_cursor: cycle883343Schema.optional(),
  has_more: hasPages8e2bc3Schema.optional(),
})

export const planeV2WorkItemsa385bbSchema = z.object({
  id: idb23e78Schema.optional(),
  name: nameeff235Schema.optional(),
  identifier: identifier88c0eaSchema.optional(),
  sequence_id: sequenceIde281c0Schema.optional(),
  priority: priority69905eSchema.optional(),
  state_id: stateId99d408Schema.optional(),
  type_id: cycle883343Schema.optional(),
  assignee_ids: assigneeIdsdfe2c4Schema.optional(),
  label_ids: labelIds6b2c72Schema.optional(),
  parent_id: cycle883343Schema.optional(),
  start_date: cycle883343Schema.optional(),
  target_date: cycle883343Schema.optional(),
  is_draft: isDraftb1b3d0Schema.optional(),
  archived_at: cycle883343Schema.optional(),
  created_at: createdAt7ff034Schema.optional(),
  created_by_id: cycle883343Schema.optional(),
  custom_fields: viewProps8d74f6Schema.optional(),
  assignees: assigneese6f198Schema.optional(),
  cycle: customFields9c1322Schema.optional(),
  labels: labelsafcc9fSchema.optional(),
  modules: membersef32d2Schema.optional(),
  parent: parentc31febSchema.optional(),
  state: statef1f313Schema.optional(),
  type: typef949c2Schema.optional(),
  cycle_id: cycleId7c066cSchema.optional(),
  module_ids: moduleIdsSchema.optional(),
  project_id: projectIdSchema.optional(),
})
