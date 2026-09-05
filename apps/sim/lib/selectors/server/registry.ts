import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { internalSelectorAttachments } from '@/lib/selectors/server/internal'
import { airtableSelectorAttachments } from '@/lib/selectors/server/providers/airtable'
import { asanaSelectorAttachments } from '@/lib/selectors/server/providers/asana'
import { attioSelectorAttachments } from '@/lib/selectors/server/providers/attio'
import { bigQuerySelectorAttachments } from '@/lib/selectors/server/providers/bigquery'
import { bitbucketSelectorAttachments } from '@/lib/selectors/server/providers/bitbucket'
import { calcomSelectorAttachments } from '@/lib/selectors/server/providers/calcom'
import { clickupSelectorAttachments } from '@/lib/selectors/server/providers/clickup'
import { cloudWatchSelectorAttachments } from '@/lib/selectors/server/providers/cloudwatch'
import { confluenceSelectorAttachments } from '@/lib/selectors/server/providers/confluence'
import { googleSelectorAttachments } from '@/lib/selectors/server/providers/google'
import { harmonicSelectorAttachments } from '@/lib/selectors/server/providers/harmonic'
import { hubspotSelectorAttachments } from '@/lib/selectors/server/providers/hubspot'
import { imapSelectorAttachments } from '@/lib/selectors/server/providers/imap'
import { jiraSelectorAttachments } from '@/lib/selectors/server/providers/jira'
import { jsmSelectorAttachments } from '@/lib/selectors/server/providers/jsm'
import { linearSelectorAttachments } from '@/lib/selectors/server/providers/linear'
import { managedAgentSelectorAttachments } from '@/lib/selectors/server/providers/managed-agent'
import { microsoftSelectorAttachments } from '@/lib/selectors/server/providers/microsoft'
import { mondaySelectorAttachments } from '@/lib/selectors/server/providers/monday'
import { netsuiteSelectorAttachments } from '@/lib/selectors/server/providers/netsuite'
import { notionSelectorAttachments } from '@/lib/selectors/server/providers/notion'
import { oracleFusionLearningSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-learning'
import { pipedriveSelectorAttachments } from '@/lib/selectors/server/providers/pipedrive'
import { sharepointSelectorAttachments } from '@/lib/selectors/server/providers/sharepoint'
import { slackSelectorAttachments } from '@/lib/selectors/server/providers/slack'
import { snowflakeSelectorAttachments } from '@/lib/selectors/server/providers/snowflake'
import { trelloSelectorAttachments } from '@/lib/selectors/server/providers/trello'
import { wealthboxSelectorAttachments } from '@/lib/selectors/server/providers/wealthbox'
import { webflowSelectorAttachments } from '@/lib/selectors/server/providers/webflow'
import { zohoDeskSelectorAttachments } from '@/lib/selectors/server/providers/zoho-desk'
import { zoomSelectorAttachments } from '@/lib/selectors/server/providers/zoom'
import type { ServerSelectorAttachment } from '@/lib/selectors/server/types'

export const serverSelectorRegistry = {
  ...internalSelectorAttachments,
  ...airtableSelectorAttachments,
  ...asanaSelectorAttachments,
  ...attioSelectorAttachments,
  ...bigQuerySelectorAttachments,
  ...bitbucketSelectorAttachments,
  ...calcomSelectorAttachments,
  ...clickupSelectorAttachments,
  ...cloudWatchSelectorAttachments,
  ...confluenceSelectorAttachments,
  ...googleSelectorAttachments,
  ...harmonicSelectorAttachments,
  ...hubspotSelectorAttachments,
  ...imapSelectorAttachments,
  ...jiraSelectorAttachments,
  ...jsmSelectorAttachments,
  ...linearSelectorAttachments,
  ...managedAgentSelectorAttachments,
  ...microsoftSelectorAttachments,
  ...mondaySelectorAttachments,
  ...netsuiteSelectorAttachments,
  ...notionSelectorAttachments,
  ...oracleFusionLearningSelectorAttachments,
  ...pipedriveSelectorAttachments,
  ...sharepointSelectorAttachments,
  ...slackSelectorAttachments,
  ...snowflakeSelectorAttachments,
  ...trelloSelectorAttachments,
  ...wealthboxSelectorAttachments,
  ...webflowSelectorAttachments,
  ...zohoDeskSelectorAttachments,
  ...zoomSelectorAttachments,
} satisfies Record<ServerSelectorKey, ServerSelectorAttachment>

export function getServerSelectorAttachment(key: ServerSelectorKey): ServerSelectorAttachment {
  return serverSelectorRegistry[key]
}
