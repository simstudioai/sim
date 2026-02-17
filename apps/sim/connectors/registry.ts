import { airtableConnector } from '@/connectors/airtable'
import { confluenceConnector } from '@/connectors/confluence'
import { githubConnector } from '@/connectors/github'
import { googleDriveConnector } from '@/connectors/google-drive'
import { jiraConnector } from '@/connectors/jira'
import { linearConnector } from '@/connectors/linear'
import { notionConnector } from '@/connectors/notion'
import type { ConnectorRegistry } from '@/connectors/types'

export const CONNECTOR_REGISTRY: ConnectorRegistry = {
  airtable: airtableConnector,
  confluence: confluenceConnector,
  github: githubConnector,
  google_drive: googleDriveConnector,
  jira: jiraConnector,
  linear: linearConnector,
  notion: notionConnector,
}
