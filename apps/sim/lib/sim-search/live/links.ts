import { parseGitHubRepository } from '@/lib/oauth/github-repository'
import { atlassianSiteId } from '@/lib/sim-search/live/atlassian'
import { NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { linearIssueReference } from '@/lib/sim-search/live/linear'
import { notionResource } from '@/lib/sim-search/live/notion-mcp'
import type { NativeClient, NativeDocument } from '@/lib/sim-search/live/types'

/** The location fields a live document ID carries, as each provider's reader expects them. */
export type LinkedReference = Pick<NativeDocument, 'id' | 'container' | 'kind' | 'threadId'>

/**
 * A provider document a pasted link names, as far as the link alone can tell. Atlassian links
 * name their site by host rather than by the cloud ID reads take, GitLab links name a host that
 * must be the account's own, Linear links name an issue by its key rather than its UUID, and a
 * file link's branch and path share one run of segments, so those finish against the account that
 * reads them.
 */
export type DocumentLink =
  | {
      provider:
        | 'google_drive'
        | 'gmail'
        | 'google_calendar'
        | 'slack'
        | 'github'
        | 'notion'
        | 'fireflies'
      reference: LinkedReference
    }
  | {
      provider: 'jira' | 'confluence' | 'gitlab'
      host: string
      reference: LinkedReference
    }
  | { provider: 'linear'; workspace: string; issueKey: string }
  | {
      provider: 'github' | 'gitlab'
      /** The host a GitLab link names; GitHub links are always github.com. */
      host?: string
      repository: string
      /** The segments after `blob`: a branch, which may itself contain slashes, then the path. */
      blob: string[]
    }

/** Providers whose links {@link parseDocumentLinks} recognizes, for the caller's error message. */
export const LINKABLE_SOURCES =
  'Google Docs, Sheets, Slides and Drive files, Gmail, Google Calendar events, Slack messages and files, Jira issues, Confluence pages, GitHub, GitLab, Linear, Notion and Fireflies'

const DRIVE_ID = /^[\w-]{10,}$/
const GOOGLE_EDITOR_KINDS: Record<string, string> = {
  document: 'application/vnd.google-apps.document',
  spreadsheets: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
}
const JIRA_KEY = /^[A-Z][A-Z\d_]*-\d+$/
const NUMERIC_ID = /^\d+$/
/** First path segments on github.com that are site pages, not repository owners. */
const GITHUB_RESERVED_OWNERS = new Set([
  'apps',
  'collections',
  'enterprises',
  'features',
  'login',
  'marketplace',
  'notifications',
  'orgs',
  'search',
  'settings',
  'sponsors',
  'topics',
  'users',
])

function pathSegments(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
}

function googleDriveLink(url: URL): DocumentLink | undefined {
  const parts = pathSegments(url)
  if (url.hostname === 'docs.google.com') {
    const kind = GOOGLE_EDITOR_KINDS[parts[0] ?? '']
    /** `/u/1/d/ID` selects a signed-in Google account; `/d/e/ID` is a published copy, not the file. */
    const rest = parts[1] === 'u' ? parts.slice(3) : parts.slice(1)
    const id = rest[0] === 'd' ? rest[1] : undefined
    if (!kind || !id || !DRIVE_ID.test(id)) return undefined
    return { provider: 'google_drive', reference: { id, kind } }
  }
  const id = parts[0] === 'file' && parts[1] === 'd' ? parts[2] : url.searchParams.get('id')
  if (!id || !DRIVE_ID.test(id) || !['file', 'open', 'uc'].includes(parts[0] ?? ''))
    return undefined
  return { provider: 'google_drive', reference: { id } }
}

/** A message ID in the fragment, as Sim's own Gmail links and classic Gmail URLs carry it. */
function gmailLink(url: URL): DocumentLink | undefined {
  const id = url.hash.split('/').at(-1)?.toLowerCase()
  if (!url.pathname.startsWith('/mail/') || !id || !/^[\da-f]{16}$/.test(id)) return undefined
  return { provider: 'gmail', reference: { id } }
}

/** `eid` is base64 of the event ID and its calendar's ID; `@m` abbreviates `@gmail.com`. */
function calendarLink(url: URL): DocumentLink | undefined {
  const eid = url.searchParams.get('eid')
  if (!eid || !/^[\w-]+={0,2}$/.test(eid)) return undefined
  const [id, calendar, ...extra] = Buffer.from(eid, 'base64url').toString('utf8').split(' ')
  if (!id || !calendar || extra.length || !/^[\w-]+$/.test(id) || !calendar.includes('@'))
    return undefined
  const container = calendar.endsWith('@m') ? `${calendar.slice(0, -2)}@gmail.com` : calendar
  return { provider: 'google_calendar', reference: { id, container } }
}

/** Message permalinks carry the timestamp without its dot; files and canvases carry the file ID. */
function slackLink(url: URL): DocumentLink | undefined {
  const parts = pathSegments(url)
  if (parts[0] === 'archives' && parts.length === 3) {
    const [, channel, message] = parts
    const digits = /^p(\d{16})$/.exec(message ?? '')?.[1]
    if (!channel || !/^[A-Z\d]+$/.test(channel) || !digits) return undefined
    const threadId = url.searchParams.get('thread_ts') ?? undefined
    return {
      provider: 'slack',
      reference: {
        id: `${digits.slice(0, 10)}.${digits.slice(10)}`,
        container: channel,
        ...(threadId && /^\d+\.\d+$/.test(threadId) ? { threadId } : {}),
      },
    }
  }
  const file = parts[0] === 'files' || parts[0] === 'docs' ? parts[2] : undefined
  if (!file || !/^F[A-Z\d]+$/.test(file)) return undefined
  return { provider: 'slack', reference: { id: file, kind: 'file' } }
}

/**
 * The path of a file link on `branch`, or undefined when the link names another branch or commit.
 * Reads and their source checks cover the default branch only, as search does.
 */
function pathOnBranch(blob: string[], branch: string): string | undefined {
  const branchParts = branch.split('/')
  const path = blob.slice(branchParts.length)
  if (
    !branch ||
    !path.length ||
    branchParts.some((part, index) => blob[index] !== part) ||
    path.some((part) => part === '.' || part === '..')
  )
    return undefined
  return path.join('/')
}

function githubRepository(owner: string, name: string): string | undefined {
  try {
    const { owner: parsedOwner, repo } = parseGitHubRepository(`${owner}/${name}`)
    return `${parsedOwner}/${repo}`
  } catch {
    return undefined
  }
}

function githubLink(url: URL): DocumentLink | undefined {
  const [owner, name, section, ...rest] = pathSegments(url)
  if (!owner || !name || GITHUB_RESERVED_OWNERS.has(owner.toLowerCase())) return undefined
  const repository = githubRepository(owner, name)
  if (!repository) return undefined
  const link = (reference: LinkedReference): DocumentLink => ({
    provider: 'github',
    reference: { container: repository, ...reference },
  })
  if (!section) return link({ id: repository, kind: 'repositories' })
  if ((section === 'issues' || section === 'pull') && NUMERIC_ID.test(rest[0] ?? '')) {
    const commit = section === 'pull' && rest[1] === 'commits' ? rest[2] : undefined
    return commit ? githubCommit(commit, link) : link({ id: rest[0] ?? '', kind: 'issues' })
  }
  if (section === 'commit') return githubCommit(rest[0], link)
  if (section === 'blob') return { provider: 'github', repository, blob: rest }
  return undefined
}

function githubCommit(
  sha: string | undefined,
  link: (reference: LinkedReference) => DocumentLink
): DocumentLink | undefined {
  return sha && /^[\da-f]{7,40}$/i.test(sha) ? link({ id: sha, kind: 'commits' }) : undefined
}

/** GitLab separates a project's path from its pages with `/-/`, on gitlab.com and self-hosted. */
function gitlabLink(url: URL): DocumentLink | undefined {
  const parts = pathSegments(url)
  const separator = parts.indexOf('-')
  if (separator < 1) return undefined
  const project = parts.slice(0, separator).join('/')
  const [section, ...rest] = parts.slice(separator + 1)
  const link = (reference: LinkedReference): DocumentLink => ({
    provider: 'gitlab',
    host: url.host,
    reference: { container: project, ...reference },
  })
  const iid = rest[0]
  if (section === 'issues' || section === 'work_items' || section === 'merge_requests')
    return iid && NUMERIC_ID.test(iid)
      ? link({ id: iid, kind: section === 'merge_requests' ? 'merge_requests' : 'issues' })
      : undefined
  if (section === 'blob')
    return { provider: 'gitlab', host: url.host, repository: project, blob: rest }
  if (section === 'wikis' && rest.length) return link({ id: rest.join('/'), kind: 'wiki' })
  return undefined
}

function jiraLink(url: URL): DocumentLink | undefined {
  const parts = pathSegments(url)
  const key = parts[0] === 'browse' ? parts[1] : url.searchParams.get('selectedIssue')
  if (!key || !JIRA_KEY.test(key)) return undefined
  return { provider: 'jira', host: url.host, reference: { id: key } }
}

function confluenceLink(url: URL): DocumentLink | undefined {
  const parts = pathSegments(url)
  if (parts[0] !== 'wiki') return undefined
  const link = (reference: LinkedReference): DocumentLink => ({
    provider: 'confluence',
    host: url.host,
    reference,
  })
  if (parts[1] === 'pages' && parts[2] === 'viewpage.action') {
    const id = url.searchParams.get('pageId')
    return id && NUMERIC_ID.test(id) ? link({ id, kind: 'page' }) : undefined
  }
  if (parts[1] !== 'spaces' || !parts[2]) return undefined
  const [section, ...rest] = parts.slice(3)
  if (section === 'pages') {
    const id = rest[0] === 'edit-v2' ? rest[1] : rest[0]
    return id && NUMERIC_ID.test(id) ? link({ id, kind: 'page' }) : undefined
  }
  if (section === 'blog') {
    /** Blog post paths put the publication date (`2026/01/31`) before the post ID. */
    const dated = /^\d{4}$/.test(rest[0] ?? '') && /^\d{2}$/.test(rest[1] ?? '')
    const id = dated ? rest[3] : rest[0]
    return id && NUMERIC_ID.test(id) ? link({ id, kind: 'blogpost' }) : undefined
  }
  if (section === undefined || section === 'overview') return link({ id: parts[2], kind: 'space' })
  return undefined
}

function linearLink(url: URL): DocumentLink | undefined {
  const [workspace, section, issueKey] = pathSegments(url)
  if (!workspace || section !== 'issue' || !issueKey || !JIRA_KEY.test(issueKey.toUpperCase()))
    return undefined
  return {
    provider: 'linear',
    workspace: workspace.toLowerCase(),
    issueKey: issueKey.toUpperCase(),
  }
}

/** Fireflies' own links end in the meeting ID, after its title and `::` when it has one. */
function firefliesLink(url: URL): DocumentLink | undefined {
  const [section, slug, ...rest] = pathSegments(url)
  const id = slug?.split('::').at(-1)
  if (section !== 'view' || rest.length || !id || !/^[\w-]{1,200}$/.test(id)) return undefined
  return { provider: 'fireflies', reference: { id, kind: 'meeting' } }
}

function notionLink(value: string): DocumentLink | undefined {
  const resource = notionResource(value)
  return resource && { provider: 'notion', reference: { id: resource.id, kind: 'mcp' } }
}

/** Parsers for hosts that serve one provider's documents. */
const HOST_PARSERS = new Map<string, (url: URL) => DocumentLink | undefined>([
  ['docs.google.com', googleDriveLink],
  ['drive.google.com', googleDriveLink],
  ['mail.google.com', gmailLink],
  ['calendar.google.com', calendarLink],
  ['www.google.com', calendarLink],
  ['github.com', githubLink],
  ['www.github.com', githubLink],
  ['linear.app', linearLink],
  ['app.fireflies.ai', firefliesLink],
])

/**
 * The provider documents a pasted link may name, or undefined when `value` is not a web link.
 * An empty list means the link names nothing Sim can read directly, such as a folder, channel or
 * site page. Hosts that can be self-hosted or custom (Atlassian, GitLab) are recognized by path,
 * so a link can name candidates of more than one provider; each is matched against the reader's
 * own accounts.
 */
export function parseDocumentLinks(value: string): DocumentLink[] | undefined {
  if (!/^https?:\/\//i.test(value)) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return []
  }
  if (url.protocol !== 'https:' || url.username || url.password) return []
  const parse =
    HOST_PARSERS.get(url.hostname) ?? (url.hostname.endsWith('.slack.com') ? slackLink : undefined)
  if (parse) return [parse(url)].filter((link) => link !== undefined)
  const notion = notionLink(value)
  if (notion) return [notion]
  return [jiraLink(url), confluenceLink(url), gitlabLink(url)].filter((link) => link !== undefined)
}

/**
 * The location within one account that `link` names, finishing what the link alone cannot say
 * with the account's provider client, or undefined when the account cannot hold it: another
 * Atlassian site, GitLab host, or Linear workspace.
 */
export async function locateDocumentLink(
  link: DocumentLink,
  account: { client: NativeClient | null; origin: string }
): Promise<LinkedReference | undefined> {
  if ('blob' in link) return locateFile(link, account)
  switch (link.provider) {
    case 'jira':
    case 'confluence': {
      if (!account.client) return undefined
      const container = await atlassianSiteId(account.client, link.host)
      return container ? { ...link.reference, container } : undefined
    }
    case 'gitlab':
      return new URL(account.origin).host === link.host ? link.reference : undefined
    case 'linear':
      return account.client
        ? linearIssueReference(account.client, link.workspace, link.issueKey)
        : undefined
    default:
      return link.reference
  }
}

/** A file link's path on the repository's default branch, read from the account's own API. */
async function locateFile(
  link: Extract<DocumentLink, { blob: string[] }>,
  account: { client: NativeClient | null; origin: string }
): Promise<LinkedReference | undefined> {
  if (!account.client) return undefined
  if (link.provider === 'gitlab' && new URL(account.origin).host !== link.host) return undefined
  const row = object(
    await account.client.json(
      link.provider === 'github'
        ? `/repos/${link.repository}`
        : `/api/v4/projects/${segment(link.repository)}`,
      { memo: true }
    )
  )
  const branch = string(row.default_branch)
  const path = pathOnBranch(link.blob, branch)
  if (!path)
    throw new NativeSearchError(
      'unavailable',
      `Sim reads repository files on the default branch (${branch || 'unknown'}), and this link names another branch or commit. Open the file on the default branch, or search for it.`
    )
  return {
    id: path,
    container:
      link.provider === 'github'
        ? string(row.full_name) || link.repository
        : string(row.path_with_namespace) || link.repository,
    kind: 'code',
  }
}
