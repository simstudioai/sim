import { airtableConnectorMeta } from '@/connectors/airtable/meta'
import { asanaConnectorMeta } from '@/connectors/asana/meta'
import { ashbyConnectorMeta } from '@/connectors/ashby/meta'
import { azureDevopsConnectorMeta } from '@/connectors/azure-devops/meta'
import { clickupConnectorMeta } from '@/connectors/clickup/meta'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { discordConnectorMeta } from '@/connectors/discord/meta'
import { docusignConnectorMeta } from '@/connectors/docusign/meta'
import { dropboxConnectorMeta } from '@/connectors/dropbox/meta'
import { evernoteConnectorMeta } from '@/connectors/evernote/meta'
import { fathomConnectorMeta } from '@/connectors/fathom/meta'
import { firefliesConnectorMeta } from '@/connectors/fireflies/meta'
import { githubConnectorMeta } from '@/connectors/github/meta'
import { gitlabConnectorMeta } from '@/connectors/gitlab/meta'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'
import { gongConnectorMeta } from '@/connectors/gong/meta'
import { googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'
import { googleDocsConnectorMeta } from '@/connectors/google-docs/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import { googleFormsConnectorMeta } from '@/connectors/google-forms/meta'
import { googleMeetConnectorMeta } from '@/connectors/google-meet/meta'
import { googleSheetsConnectorMeta } from '@/connectors/google-sheets/meta'
import { grainConnectorMeta } from '@/connectors/grain/meta'
import { granolaConnectorMeta } from '@/connectors/granola/meta'
import { greenhouseConnectorMeta } from '@/connectors/greenhouse/meta'
import { hubspotConnectorMeta } from '@/connectors/hubspot/meta'
import { incidentioConnectorMeta } from '@/connectors/incidentio/meta'
import { intercomConnectorMeta } from '@/connectors/intercom/meta'
import { jiraConnectorMeta } from '@/connectors/jira/meta'
import { jsmConnectorMeta } from '@/connectors/jsm/meta'
import { linearConnectorMeta } from '@/connectors/linear/meta'
import { microsoftTeamsConnectorMeta } from '@/connectors/microsoft-teams/meta'
import { mondayConnectorMeta } from '@/connectors/monday/meta'
import { notionConnectorMeta } from '@/connectors/notion/meta'
import { obsidianConnectorMeta } from '@/connectors/obsidian/meta'
import { onedriveConnectorMeta } from '@/connectors/onedrive/meta'
import { outlookConnectorMeta } from '@/connectors/outlook/meta'
import { redditConnectorMeta } from '@/connectors/reddit/meta'
import { rootlyConnectorMeta } from '@/connectors/rootly/meta'
import { s3ConnectorMeta } from '@/connectors/s3/meta'
import { salesforceConnectorMeta } from '@/connectors/salesforce/meta'
import { sentryConnectorMeta } from '@/connectors/sentry/meta'
import { servicenowConnectorMeta } from '@/connectors/servicenow/meta'
import { sharepointConnectorMeta } from '@/connectors/sharepoint/meta'
import { slackConnectorMeta } from '@/connectors/slack/meta'
import { typeformConnectorMeta } from '@/connectors/typeform/meta'
import type { ConnectorMeta, ConnectorMetaRegistry } from '@/connectors/types'
import { webflowConnectorMeta } from '@/connectors/webflow/meta'
import { wordpressConnectorMeta } from '@/connectors/wordpress/meta'
import { xConnectorMeta } from '@/connectors/x/meta'
import { youtubeConnectorMeta } from '@/connectors/youtube/meta'
import { zendeskConnectorMeta } from '@/connectors/zendesk/meta'
import { zoomConnectorMeta } from '@/connectors/zoom/meta'

/**
 * Client-safe registry of connector metadata. Imports each connector's `meta.ts`
 * (never the runtime module), so it carries no server-only code and can be used
 * from client components — the metadata counterpart to the full
 * `CONNECTOR_REGISTRY` in `@/connectors/registry.server`, mirroring the
 * `BLOCK_META_REGISTRY` split in `@/blocks/registry`.
 */
export const CONNECTOR_META_REGISTRY: ConnectorMetaRegistry = {
  airtable: airtableConnectorMeta,
  asana: asanaConnectorMeta,
  ashby: ashbyConnectorMeta,
  azure_devops: azureDevopsConnectorMeta,
  clickup: clickupConnectorMeta,
  confluence: confluenceConnectorMeta,
  discord: discordConnectorMeta,
  docusign: docusignConnectorMeta,
  dropbox: dropboxConnectorMeta,
  evernote: evernoteConnectorMeta,
  fathom: fathomConnectorMeta,
  fireflies: firefliesConnectorMeta,
  github: githubConnectorMeta,
  gitlab: gitlabConnectorMeta,
  gmail: gmailConnectorMeta,
  gong: gongConnectorMeta,
  google_calendar: googleCalendarConnectorMeta,
  google_docs: googleDocsConnectorMeta,
  google_drive: googleDriveConnectorMeta,
  google_forms: googleFormsConnectorMeta,
  google_meet: googleMeetConnectorMeta,
  google_sheets: googleSheetsConnectorMeta,
  grain: grainConnectorMeta,
  granola: granolaConnectorMeta,
  greenhouse: greenhouseConnectorMeta,
  hubspot: hubspotConnectorMeta,
  incidentio: incidentioConnectorMeta,
  intercom: intercomConnectorMeta,
  jira: jiraConnectorMeta,
  jsm: jsmConnectorMeta,
  linear: linearConnectorMeta,
  microsoft_teams: microsoftTeamsConnectorMeta,
  monday: mondayConnectorMeta,
  notion: notionConnectorMeta,
  obsidian: obsidianConnectorMeta,
  onedrive: onedriveConnectorMeta,
  outlook: outlookConnectorMeta,
  reddit: redditConnectorMeta,
  rootly: rootlyConnectorMeta,
  s3: s3ConnectorMeta,
  salesforce: salesforceConnectorMeta,
  sentry: sentryConnectorMeta,
  servicenow: servicenowConnectorMeta,
  sharepoint: sharepointConnectorMeta,
  slack: slackConnectorMeta,
  typeform: typeformConnectorMeta,
  webflow: webflowConnectorMeta,
  wordpress: wordpressConnectorMeta,
  x: xConnectorMeta,
  youtube: youtubeConnectorMeta,
  zendesk: zendeskConnectorMeta,
  zoom: zoomConnectorMeta,
}

/**
 * Look up a single connector's metadata by ID. Returns `undefined` for unknown IDs.
 */
export function getConnectorMeta(connectorId: string): ConnectorMeta | undefined {
  return CONNECTOR_META_REGISTRY[connectorId]
}

/**
 * Return all connector metadata as an ID-keyed record.
 */
export function getAllConnectorMeta(): ConnectorMetaRegistry {
  return CONNECTOR_META_REGISTRY
}
