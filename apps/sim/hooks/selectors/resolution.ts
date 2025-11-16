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
}

const defaultContext: SelectorContext = {}

export function resolveSelectorForSubBlock(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution | null {
  switch (subBlock.type) {
    case 'file-selector':
      return resolveFileSelector(subBlock, args)
    case 'folder-selector':
      return resolveFolderSelector(subBlock, args)
    case 'channel-selector':
      return resolveChannelSelector(subBlock, args)
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

  const provider = subBlock.provider || subBlock.serviceId || ''

  switch (provider) {
    case 'google-calendar':
      return { key: 'google.calendar', context, allowSearch: false }
    case 'confluence':
      return { key: 'confluence.pages', context, allowSearch: true }
    case 'jira':
      return { key: 'jira.issues', context, allowSearch: true }
    case 'microsoft-teams':
      return { key: 'microsoft.teams', context, allowSearch: true }
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
    default:
      break
  }

  if (subBlock.serviceId === 'onedrive') {
    const key: SelectorKey = subBlock.mimeType === 'file' ? 'onedrive.files' : 'onedrive.folders'
    return { key, context, allowSearch: true }
  }

  if (subBlock.serviceId === 'sharepoint') {
    return { key: 'sharepoint.sites', context, allowSearch: true }
  }

  if (subBlock.serviceId === 'google-sheets') {
    return { key: 'google.drive', context, allowSearch: true }
  }

  return { key: null, context, allowSearch: true }
}

function resolveFolderSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const provider = (subBlock.provider || subBlock.serviceId || 'gmail').toLowerCase()
  const key: SelectorKey = provider === 'outlook' ? 'outlook.folders' : 'gmail.labels'
  return {
    key,
    context: buildBaseContext(args),
    allowSearch: true,
  }
}

function resolveChannelSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const provider = subBlock.provider || 'slack'
  if (provider !== 'slack') {
    return { key: null, context: buildBaseContext(args), allowSearch: true }
  }
  return {
    key: 'slack.channels',
    context: buildBaseContext(args),
    allowSearch: true,
  }
}

function resolveProjectSelector(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution {
  const provider = subBlock.provider || 'jira'
  const context = buildBaseContext(args)

  if (provider === 'linear') {
    const key: SelectorKey = subBlock.id === 'teamId' ? 'linear.teams' : 'linear.projects'
    return {
      key,
      context,
      allowSearch: true,
    }
  }

  return {
    key: 'jira.projects',
    context,
    allowSearch: true,
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
