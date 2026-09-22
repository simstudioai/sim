import { z } from 'zod'
import { parseCodaResourceUri } from '@/lib/sim-search/live/coda-uri'
import {
  LIVE_SEARCH_PROVIDER_IDS,
  supportsLiveSearchMode,
} from '@/lib/sim-search/live/provider-catalog'

const resourceList = z.array(z.string().trim().min(1).max(500)).max(100)

export const LIVE_SEARCH_SERVICE_PROVIDERS: readonly string[] = LIVE_SEARCH_PROVIDER_IDS.filter(
  (provider) => supportsLiveSearchMode(provider, 'service_account')
)

/** Resource restrictions are trusted server configuration, independent of model queries. */
export const liveSearchPolicySchema = z
  .object({
    version: z.literal(1),
    accessMode: z.enum(['member', 'service_account']).optional(),
    sourceId: z.string().trim().min(1).max(100).optional(),
    mode: z.enum(['all', 'selected']),
    included: resourceList,
    excluded: resourceList,
    sites: resourceList,
    includeSubfolders: z.boolean(),
    includeDirectMessages: z.boolean(),
    includeArchived: z.boolean(),
    includeAttendees: z.boolean(),
    excludePromotions: z.boolean(),
    excludeSocial: z.boolean(),
    fileTypes: resourceList,
    pathPrefixes: resourceList,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'selected' && value.included.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['included'],
        message: 'Choose at least one source, or select all accessible sources.',
      })
  })
export type LiveSearchPolicy = z.output<typeof liveSearchPolicySchema>

export function defaultLiveSearchPolicy(provider?: string): LiveSearchPolicy {
  return {
    version: 1,
    accessMode: provider === 'gitlab' ? 'service_account' : 'member',
    mode: 'all',
    included: [],
    excluded: [],
    sites: [],
    includeSubfolders: true,
    includeDirectMessages: true,
    includeArchived: true,
    includeAttendees: true,
    excludePromotions: false,
    excludeSocial: false,
    fileTypes: [],
    pathPrefixes: [],
  }
}

export const LIVE_SEARCH_SCOPE_FIELDS: Record<
  string,
  { label: string; hint: string; example: string }
> = {
  google_drive: {
    label: 'Folders and shared drives',
    hint: 'Paste folder IDs or Drive folder URLs. Use drive:ID for an entire shared drive.',
    example: 'https://drive.google.com/drive/folders/…',
  },
  gmail: {
    label: 'Labels',
    hint: 'Use label names. The same names are matched in each person’s mailbox.',
    example: 'INBOX, Customer requests',
  },
  google_calendar: {
    label: 'Calendars',
    hint: 'Use calendar IDs from Google Calendar settings. Use primary for each person’s primary calendar.',
    example: 'primary, team@example.com',
  },
  slack: {
    label: 'Channels',
    hint: 'Paste channel IDs or Slack channel links.',
    example: 'C0123456789',
  },
  github: {
    label: 'Repositories',
    hint: 'Use owner/repository or paste a GitHub repository URL.',
    example: 'simstudioai/sim',
  },
  gitlab: {
    label: 'Projects',
    hint: 'Use project IDs or namespace/project paths. Restrict the instance below when connecting multiple GitLab hosts.',
    example: 'engineering/platform',
  },
  jira: {
    label: 'Projects',
    hint: 'Use Jira project keys. Restrict the site below when projects share a key.',
    example: 'ENG, PRODUCT',
  },
  confluence: {
    label: 'Spaces',
    hint: 'Use Confluence space keys. Restrict the site below when spaces share a key.',
    example: 'ENG, TEAM',
  },
  coda: {
    label: 'Documents',
    hint: 'Use document IDs or superhuman://docs/ID references.',
    example: 'superhuman://docs/AbCdEf123',
  },
}

/** Canonicalize pasted references without allowing them to select a request destination. */
export function normalizePolicyResource(provider: string, value: string): string {
  const trimmed = value.trim()
  if (provider === 'coda') {
    if (trimmed.includes('://')) {
      const resource = parseCodaResourceUri(trimmed)
      if (!resource) throw new Error('Use a Coda document ID or document URI.')
      return resource.docId
    }
    return trimmed
  }
  if (!trimmed.startsWith('https://'))
    return provider === 'github' ? trimmed.toLowerCase() : trimmed
  const url = new URL(trimmed)
  if (url.username || url.password) throw new Error('Use a resource URL without credentials.')
  if (provider === 'google_drive' && url.hostname === 'drive.google.com') {
    const id = url.pathname.match(/\/folders\/([\w-]+)/)?.[1]
    if (id) return id
  }
  if (provider === 'github' && url.hostname === 'github.com')
    return url.pathname.split('/').filter(Boolean).slice(0, 2).join('/').toLowerCase()
  if (
    provider === 'slack' &&
    (url.hostname.endsWith('.slack.com') || url.hostname === 'app.slack.com')
  ) {
    const id = url.pathname.split('/').find((part) => /^[CGD][A-Z0-9]+$/.test(part))
    if (id) return id
  }
  throw new Error('Use the resource ID shown in the field description.')
}

function normalizeSite(value: string): string {
  const url = new URL(value.includes('://') ? value : `https://${value}`)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Allowed sites must be hostnames, with an optional HTTPS port.')
  return url.host.toLowerCase()
}

export function normalizeLiveSearchPolicy(
  provider: string,
  input: LiveSearchPolicy
): LiveSearchPolicy {
  if (!LIVE_SEARCH_SCOPE_FIELDS[provider])
    throw new Error('This integration does not support live search scopes.')
  const parsed = liveSearchPolicySchema.safeParse(input)
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'Check the search scope settings.')
  const policy = parsed.data
  const patterns: Record<string, RegExp> = {
    google_drive: /^(?:drive:)?[\w-]+$/,
    slack: /^[CGD][A-Z0-9]+$/,
    github: /^[\w.-]+\/[\w.-]+$/,
    gitlab: /^(?:[1-9]\d*|[\w.-]+(?:\/[\w.-]+)+)$/,
    jira: /^[A-Za-z][A-Za-z0-9_]*$/,
    confluence: /^[A-Za-z0-9_~-]+$/,
    coda: /^[\w-]+$/,
  }
  const canonical = (values: string[]) => [
    ...new Set(
      values.map((value) => {
        const id = normalizePolicyResource(provider, value)
        if (patterns[provider] && !patterns[provider].test(id))
          throw new Error(
            `Enter valid ${LIVE_SEARCH_SCOPE_FIELDS[provider]!.label.toLowerCase()} using the format shown.`
          )
        return provider === 'jira' ? id.toUpperCase() : id
      })
    ),
  ]
  return liveSearchPolicySchema.parse({
    ...policy,
    included: canonical(policy.included),
    excluded: canonical(policy.excluded),
    sites: [...new Set(policy.sites.map(normalizeSite))],
    pathPrefixes: [
      ...new Set(
        policy.pathPrefixes.map((path) => {
          const normalized = path.replace(/^\/+|\/+$/g, '')
          if (
            !normalized ||
            normalized.includes('\\') ||
            normalized.split('/').some((part) => part === '.' || part === '..' || !part)
          )
            throw new Error('Code paths must be relative directory paths without . or .. segments.')
          return normalized
        })
      ),
    ],
  })
}

/** Direct provider operations cannot bypass restrictions enforced by the document search/read path. */
export function requiresScopedRetrieval(provider: string, policy: LiveSearchPolicy): boolean {
  return (
    policy.mode === 'selected' ||
    policy.excluded.length > 0 ||
    policy.sites.length > 0 ||
    policy.pathPrefixes.length > 0 ||
    policy.fileTypes.length > 0 ||
    (['slack', 'github', 'gitlab'].includes(provider) && !policy.includeArchived) ||
    (provider === 'slack' && !policy.includeDirectMessages) ||
    (provider === 'google_calendar' && !policy.includeAttendees) ||
    (provider === 'gmail' && (policy.excludePromotions || policy.excludeSocial))
  )
}
