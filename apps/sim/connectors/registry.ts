import { airtableConnector } from '@/connectors/airtable'
import { asanaConnector } from '@/connectors/asana'
import { ashbyConnector } from '@/connectors/ashby'
import { azureDevopsConnector } from '@/connectors/azure-devops'
import { confluenceConnector } from '@/connectors/confluence'
import { discordConnector } from '@/connectors/discord'
import { docusignConnector } from '@/connectors/docusign'
import { dropboxConnector } from '@/connectors/dropbox'
import { evernoteConnector } from '@/connectors/evernote'
import { fathomConnector } from '@/connectors/fathom'
import { firefliesConnector } from '@/connectors/fireflies'
import { githubConnector } from '@/connectors/github'
import { gitlabConnector } from '@/connectors/gitlab'
import { gmailConnector } from '@/connectors/gmail'
import { gongConnector } from '@/connectors/gong'
import { googleCalendarConnector } from '@/connectors/google-calendar'
import { googleDocsConnector } from '@/connectors/google-docs'
import { googleDriveConnector } from '@/connectors/google-drive'
import { googleFormsConnector } from '@/connectors/google-forms'
import { googleSheetsConnector } from '@/connectors/google-sheets'
import { grainConnector } from '@/connectors/grain'
import { granolaConnector } from '@/connectors/granola'
import { greenhouseConnector } from '@/connectors/greenhouse'
import { hubspotConnector } from '@/connectors/hubspot'
import { incidentioConnector } from '@/connectors/incidentio'
import { intercomConnector } from '@/connectors/intercom'
import { jiraConnector } from '@/connectors/jira'
import { jsmConnector } from '@/connectors/jsm'
import { linearConnector } from '@/connectors/linear'
import { microsoftTeamsConnector } from '@/connectors/microsoft-teams'
import { mondayConnector } from '@/connectors/monday'
import { notionConnector } from '@/connectors/notion'
import { obsidianConnector } from '@/connectors/obsidian'
import { onedriveConnector } from '@/connectors/onedrive'
import { outlookConnector } from '@/connectors/outlook'
import { redditConnector } from '@/connectors/reddit'
import { rootlyConnector } from '@/connectors/rootly'
import { s3Connector } from '@/connectors/s3'
import { salesforceConnector } from '@/connectors/salesforce'
import { sentryConnector } from '@/connectors/sentry'
import { servicenowConnector } from '@/connectors/servicenow'
import { sharepointConnector } from '@/connectors/sharepoint'
import { slackConnector } from '@/connectors/slack'
import { typeformConnector } from '@/connectors/typeform'
import type { ConnectorRegistry } from '@/connectors/types'
import { webflowConnector } from '@/connectors/webflow'
import { wordpressConnector } from '@/connectors/wordpress'
import { xConnector } from '@/connectors/x'
import { youtubeConnector } from '@/connectors/youtube'
import { zendeskConnector } from '@/connectors/zendesk'
import { zoomConnector } from '@/connectors/zoom'

export const CONNECTOR_REGISTRY: ConnectorRegistry = {
  airtable: airtableConnector,
  asana: asanaConnector,
  ashby: ashbyConnector,
  azure_devops: azureDevopsConnector,
  confluence: confluenceConnector,
  discord: discordConnector,
  docusign: docusignConnector,
  dropbox: dropboxConnector,
  evernote: evernoteConnector,
  fathom: fathomConnector,
  fireflies: firefliesConnector,
  github: githubConnector,
  gitlab: gitlabConnector,
  gmail: gmailConnector,
  gong: gongConnector,
  google_calendar: googleCalendarConnector,
  google_docs: googleDocsConnector,
  google_drive: googleDriveConnector,
  google_forms: googleFormsConnector,
  google_sheets: googleSheetsConnector,
  grain: grainConnector,
  granola: granolaConnector,
  greenhouse: greenhouseConnector,
  hubspot: hubspotConnector,
  incidentio: incidentioConnector,
  intercom: intercomConnector,
  jira: jiraConnector,
  jsm: jsmConnector,
  linear: linearConnector,
  microsoft_teams: microsoftTeamsConnector,
  monday: mondayConnector,
  notion: notionConnector,
  obsidian: obsidianConnector,
  onedrive: onedriveConnector,
  outlook: outlookConnector,
  reddit: redditConnector,
  rootly: rootlyConnector,
  s3: s3Connector,
  salesforce: salesforceConnector,
  sentry: sentryConnector,
  servicenow: servicenowConnector,
  sharepoint: sharepointConnector,
  slack: slackConnector,
  typeform: typeformConnector,
  webflow: webflowConnector,
  wordpress: wordpressConnector,
  x: xConnector,
  youtube: youtubeConnector,
  zendesk: zendeskConnector,
  zoom: zoomConnector,
}
