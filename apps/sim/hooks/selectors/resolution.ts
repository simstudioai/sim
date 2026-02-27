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

export function resolveSelectorForSubBlock(
  subBlock: SubBlockConfig,
  args: SelectorResolutionArgs
): SelectorResolution | null {
  if (!subBlock.selectorKey) return null
  return {
    key: subBlock.selectorKey,
    context: {
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
      mimeType: subBlock.mimeType,
    },
    allowSearch: subBlock.selectorAllowSearch ?? true,
  }
}
