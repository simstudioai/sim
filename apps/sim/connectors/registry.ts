import { airtableConnector } from '@/connectors/airtable'
import { asanaConnector } from '@/connectors/asana'
import { confluenceConnector } from '@/connectors/confluence'
import { dropboxConnector } from '@/connectors/dropbox'
import { firefliesConnector } from '@/connectors/fireflies'
import { githubConnector } from '@/connectors/github'
import { googleDocsConnector } from '@/connectors/google-docs'
import { googleDriveConnector } from '@/connectors/google-drive'
import { hubspotConnector } from '@/connectors/hubspot'
import { jiraConnector } from '@/connectors/jira'
import { linearConnector } from '@/connectors/linear'
import { notionConnector } from '@/connectors/notion'
import { onedriveConnector } from '@/connectors/onedrive'
import { salesforceConnector } from '@/connectors/salesforce'
import { sharepointConnector } from '@/connectors/sharepoint'
import { slackConnector } from '@/connectors/slack'
import type { ConnectorRegistry } from '@/connectors/types'
import { webflowConnector } from '@/connectors/webflow'
import { wordpressConnector } from '@/connectors/wordpress'

export const CONNECTOR_REGISTRY: ConnectorRegistry = {
  airtable: airtableConnector,
  asana: asanaConnector,
  confluence: confluenceConnector,
  dropbox: dropboxConnector,
  fireflies: firefliesConnector,
  github: githubConnector,
  google_docs: googleDocsConnector,
  google_drive: googleDriveConnector,
  hubspot: hubspotConnector,
  jira: jiraConnector,
  linear: linearConnector,
  notion: notionConnector,
  onedrive: onedriveConnector,
  salesforce: salesforceConnector,
  sharepoint: sharepointConnector,
  slack: slackConnector,
  webflow: webflowConnector,
  wordpress: wordpressConnector,
}
