import { airtableSelectors } from '@/hooks/selectors/providers/airtable/selectors'
import { asanaSelectors } from '@/hooks/selectors/providers/asana/selectors'
import { attioSelectors } from '@/hooks/selectors/providers/attio/selectors'
import { bigquerySelectors } from '@/hooks/selectors/providers/bigquery/selectors'
import { calcomSelectors } from '@/hooks/selectors/providers/calcom/selectors'
import { cloudwatchSelectors } from '@/hooks/selectors/providers/cloudwatch/selectors'
import { confluenceSelectors } from '@/hooks/selectors/providers/confluence/selectors'
import { googleSelectors } from '@/hooks/selectors/providers/google/selectors'
import { jiraSelectors } from '@/hooks/selectors/providers/jira/selectors'
import { jsmSelectors } from '@/hooks/selectors/providers/jsm/selectors'
import { knowledgeSelectors } from '@/hooks/selectors/providers/knowledge/selectors'
import { linearSelectors } from '@/hooks/selectors/providers/linear/selectors'
import { microsoftSelectors } from '@/hooks/selectors/providers/microsoft/selectors'
import { mondaySelectors } from '@/hooks/selectors/providers/monday/selectors'
import { notionSelectors } from '@/hooks/selectors/providers/notion/selectors'
import { pipedriveSelectors } from '@/hooks/selectors/providers/pipedrive/selectors'
import { sharepointSelectors } from '@/hooks/selectors/providers/sharepoint/selectors'
import { simSelectors } from '@/hooks/selectors/providers/sim/selectors'
import { slackSelectors } from '@/hooks/selectors/providers/slack/selectors'
import { trelloSelectors } from '@/hooks/selectors/providers/trello/selectors'
import { wealthboxSelectors } from '@/hooks/selectors/providers/wealthbox/selectors'
import { webflowSelectors } from '@/hooks/selectors/providers/webflow/selectors'
import { zoomSelectors } from '@/hooks/selectors/providers/zoom/selectors'
import type { SelectorDefinition, SelectorKey, SelectorOption } from '@/hooks/selectors/types'

export const selectorRegistry = {
  ...airtableSelectors,
  ...asanaSelectors,
  ...attioSelectors,
  ...bigquerySelectors,
  ...calcomSelectors,
  ...confluenceSelectors,
  ...jsmSelectors,
  ...googleSelectors,
  ...microsoftSelectors,
  ...notionSelectors,
  ...pipedriveSelectors,
  ...sharepointSelectors,
  ...trelloSelectors,
  ...zoomSelectors,
  ...slackSelectors,
  ...wealthboxSelectors,
  ...jiraSelectors,
  ...mondaySelectors,
  ...linearSelectors,
  ...knowledgeSelectors,
  ...webflowSelectors,
  ...cloudwatchSelectors,
  ...simSelectors,
} satisfies Record<SelectorKey, SelectorDefinition>

export function getSelectorDefinition(key: SelectorKey): SelectorDefinition {
  const definition = selectorRegistry[key]
  if (!definition) {
    throw new Error(`Missing selector definition for ${key}`)
  }
  return definition
}

export function mergeOption(options: SelectorOption[], option?: SelectorOption | null) {
  if (!option) return options
  if (options.some((item) => item.id === option.id)) {
    return options
  }
  return [option, ...options]
}
