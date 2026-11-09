import 'server-only'
import { buildSlackAppCreationUrl } from '@/lib/integrations/slack-manifest'
import {
  createSlackSearchManifest,
  SLACK_SEARCH_DEFAULT_DESCRIPTION,
  SLACK_SEARCH_DEFAULT_NAME,
} from '@/lib/slack-search/manifest'

export type {
  SlackSearchInstallationView,
  SlackSearchList,
} from '@/lib/api/contracts/knowledge/slack'

export function readSlackManifest(origin: string, name: string = SLACK_SEARCH_DEFAULT_NAME) {
  const manifest = JSON.stringify(
    createSlackSearchManifest(name, SLACK_SEARCH_DEFAULT_DESCRIPTION, origin),
    null,
    2
  )
  return { manifest, createAppUrl: buildSlackAppCreationUrl(manifest) }
}
