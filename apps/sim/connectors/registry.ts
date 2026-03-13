import { airtableConnector } from '@/connectors/airtable'
import { asanaConnector } from '@/connectors/asana'
import { confluenceConnector } from '@/connectors/confluence'
import { discordConnector } from '@/connectors/discord'
import { dropboxConnector } from '@/connectors/dropbox'
import { evernoteConnector } from '@/connectors/evernote'
import { firefliesConnector } from '@/connectors/fireflies'
import { githubConnector } from '@/connectors/github'
import { gmailConnector } from '@/connectors/gmail'
import { googleCalendarConnector } from '@/connectors/google-calendar'
import { googleDocsConnector } from '@/connectors/google-docs'
import { googleDriveConnector } from '@/connectors/google-drive'
import { googleSheetsConnector } from '@/connectors/google-sheets'
import { hubspotConnector } from '@/connectors/hubspot'
import { intercomConnector } from '@/connectors/intercom'
import { jiraConnector } from '@/connectors/jira'
import { linearConnector } from '@/connectors/linear'
import { microsoftTeamsConnector } from '@/connectors/microsoft-teams'
import { notionConnector } from '@/connectors/notion'
import { obsidianConnector } from '@/connectors/obsidian'
import { onedriveConnector } from '@/connectors/onedrive'
import { outlookConnector } from '@/connectors/outlook'
import { redditConnector } from '@/connectors/reddit'
import { salesforceConnector } from '@/connectors/salesforce'
import { servicenowConnector } from '@/connectors/servicenow'
import { sharepointConnector } from '@/connectors/sharepoint'
import { slackConnector } from '@/connectors/slack'
import type { ConnectorRegistry } from '@/connectors/types'
import { webflowConnector } from '@/connectors/webflow'
import { wordpressConnector } from '@/connectors/wordpress'
import { zendeskConnector } from '@/connectors/zendesk'

export const CONNECTOR_REGISTRY: ConnectorRegistry = {
  airtable: airtableConnector,
  asana: asanaConnector,
  confluence: confluenceConnector,
  discord: discordConnector,
  dropbox: dropboxConnector,
  evernote: evernoteConnector,
  fireflies: firefliesConnector,
  github: githubConnector,
  gmail: gmailConnector,
  google_calendar: googleCalendarConnector,
  google_docs: googleDocsConnector,
  google_drive: googleDriveConnector,
  google_sheets: googleSheetsConnector,
  hubspot: hubspotConnector,
  intercom: intercomConnector,
  jira: jiraConnector,
  linear: linearConnector,
  microsoft_teams: microsoftTeamsConnector,
  notion: notionConnector,
  obsidian: obsidianConnector,
  onedrive: onedriveConnector,
  outlook: outlookConnector,
  reddit: redditConnector,
  salesforce: salesforceConnector,
  servicenow: servicenowConnector,
  sharepoint: sharepointConnector,
  slack: slackConnector,
  webflow: webflowConnector,
  wordpress: wordpressConnector,
  zendesk: zendeskConnector,
}
