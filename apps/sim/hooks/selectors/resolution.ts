import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'

export interface SelectorResolution {
  key: SelectorKey | null
  context: SelectorContext
  allowSearch: boolean
}

export interface SelectorResolutionArgs {
  workflowId?: string
  credentialId?: string
  domain?: string
  projectId?: string
  planId?: string
  teamId?: string
  knowledgeBaseId?: string
  siteId?: string
  collectionId?: string
  spreadsheetId?: string
}

const defaultContext: SelectorContext = {}

export function resolveSelectorForSubBlock(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution | null {
  switch (subBlock.type) {
    case 'file-selector':
      return resolveFileSelector(subBlock, args)
    case 'sheet-selector':
      return resolveSheetSelector(subBlock, args)
    case 'folder-selector':
      return resolveFolderSelector(subBlock, args)
    case 'channel-selector':
      return resolveChannelSelector(subBlock, args)
    case 'user-selector':
      return resolveUserSelector(subBlock, args)
    case 'project-selector':
      return resolveProjectSelector(subBlock, args)
    case 'document-selector':
      return resolveDocumentSelector(subBlock, args)
    default:
      return null
  }
}

function buildBaseContext(
  args: SelectorResolutionArgs,
  extra?: Partial<SelectorContext>
): SelectorContext {
  return {
    ...defaultContext,
    workflowId: args.workflowId,
    credentialId: args.credentialId,
    domain: args.domain,
    projectId: args.projectId,
    planId: args.planId,
    teamId: args.teamId,
    knowledgeBaseId: args.knowledgeBaseId,
    siteId: args.siteId,
    collectionId: args.collectionId,
    spreadsheetId: args.spreadsheetId,
    ...extra,
  }
}

function resolveFileSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const context = buildBaseContext(args, {
    mimeType: subBlock.mimeType,
  })

  // Use serviceId as the canonical identifier
  const serviceId = subBlock.serviceId || ''

  switch (serviceId) {
    case 'google-calendar':
      return { key: 'google.calendar', context, allowSearch: false }
    case 'confluence':
      return { key: 'confluence.pages', context, allowSearch: true }
    case 'jira':
      return { key: 'jira.issues', context, allowSearch: true }
    case 'microsoft-teams':
      // Route to the correct selector based on what type of resource is being selected
      if (subBlock.id === 'chatId') {
        return { key: 'microsoft.chats', context, allowSearch: false }
      }
      if (subBlock.id === 'channelId') {
        return { key: 'microsoft.channels', context, allowSearch: false }
      }
      // Default to teams selector for teamId
      return { key: 'microsoft.teams', context, allowSearch: false }
    case 'wealthbox':
      return { key: 'wealthbox.contacts', context, allowSearch: true }
    case 'microsoft-planner':
      return { key: 'microsoft.planner', context, allowSearch: true }
    case 'microsoft-excel':
      return { key: 'microsoft.excel', context, allowSearch: true }
    case 'microsoft-word':
      return { key: 'microsoft.word', context, allowSearch: true }
    case 'google-drive':
      return { key: 'google.drive', context, allowSearch: true }
    case 'google-sheets':
      return { key: 'google.drive', context, allowSearch: true }
    case 'google-docs':
      return { key: 'google.drive', context, allowSearch: true }
    case 'google-slides':
      return { key: 'google.drive', context, allowSearch: true }
    case 'google-forms':
      return { key: 'google.drive', context, allowSearch: true }
    case 'onedrive': {
      const key: SelectorKey = subBlock.mimeType === 'file' ? 'onedrive.files' : 'onedrive.folders'
      return { key, context, allowSearch: true }
    }
    case 'sharepoint':
      return { key: 'sharepoint.sites', context, allowSearch: true }
    case 'webflow':
      if (subBlock.id === 'collectionId') {
        return { key: 'webflow.collections', context, allowSearch: false }
      }
      if (subBlock.id === 'itemId') {
        return { key: 'webflow.items', context, allowSearch: true }
      }
      return { key: null, context, allowSearch: true }
    default:
      return { key: null, context, allowSearch: true }
  }
}

function resolveSheetSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const serviceId = subBlock.serviceId
  const context = buildBaseContext(args)

  switch (serviceId) {
    case 'google-sheets':
      return { key: 'google.sheets', context, allowSearch: false }
    case 'microsoft-excel':
      return { key: 'microsoft.excel.sheets', context, allowSearch: false }
    default:
      return { key: null, context, allowSearch: false }
  }
}

function resolveFolderSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const serviceId = subBlock.serviceId?.toLowerCase()
  if (!serviceId) {
    return { key: null, context: buildBaseContext(args), allowSearch: true }
  }

  switch (serviceId) {
    case 'gmail':
      return { key: 'gmail.labels', context: buildBaseContext(args), allowSearch: true }
    case 'outlook':
      return { key: 'outlook.folders', context: buildBaseContext(args), allowSearch: true }
    default:
      return { key: null, context: buildBaseContext(args), allowSearch: true }
  }
}

function resolveChannelSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const serviceId = subBlock.serviceId
  if (serviceId !== 'slack') {
    return { key: null, context: buildBaseContext(args), allowSearch: true }
  }
  return {
    key: 'slack.channels',
    context: buildBaseContext(args),
    allowSearch: true,
  }
}

function resolveUserSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const serviceId = subBlock.serviceId
  if (serviceId !== 'slack') {
    return { key: null, context: buildBaseContext(args), allowSearch: true }
  }
  return {
    key: 'slack.users',
    context: buildBaseContext(args),
    allowSearch: true,
  }
}

function resolveProjectSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const serviceId = subBlock.serviceId
  const context = buildBaseContext(args)
  const selectorId = subBlock.canonicalParamId ?? subBlock.id

  switch (serviceId) {
    case 'linear': {
      const key: SelectorKey = selectorId === 'teamId' ? 'linear.teams' : 'linear.projects'
      return { key, context, allowSearch: true }
    }
    case 'jira':
      return { key: 'jira.projects', context, allowSearch: true }
    case 'webflow':
      return { key: 'webflow.sites', context, allowSearch: false }
    default:
      return { key: null, context, allowSearch: true }
  }
}

function resolveDocumentSelector(
  _subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  return {
    key: 'knowledge.documents',
    context: buildBaseContext(args),
    allowSearch: true,
  }
}
