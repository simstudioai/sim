/**
 * The organization `test-org-redesign-e2e.ts` runs against, shared with its seed: Enterprise, a
 * small admin team over a large group of members who cannot build, and made-up names throughout.
 */
export const ORGANIZATION_ID = 'org-redesign-organization'
export const OUTSIDE_ORGANIZATION_ID = 'org-redesign-outside'
export const ORGANIZATION_NAME = 'Ridgeline Outfitters'
export const PASSWORD = 'org-redesign-password-1'
export const LINK_COUNT = 183

const person = (key: string, name: string, role: 'owner' | 'admin' | 'member') => ({
  key,
  name,
  role,
  userId: `org-redesign-user-${key}`,
  email: `${key}@org-redesign.test`,
  sessionToken: `org-redesign-session-${key}`,
})

export const OWNER = person('owner', 'Olive Owner', 'owner')
export const ADMIN = person('admin', 'Ada Admin', 'admin')
/** Connected to nothing, the most common member today. */
export const MEMBER = person('member', 'Mia Member', 'member')
/** A member of the same group with managed Google accounts. */
export const CONNECTED = person('connected', 'Cory Connected', 'member')
/** A member of a much narrower group, with no workspaces. */
export const NARROW = person('narrow', 'Nia Narrow', 'member')
/** Belongs to another organization only. */
export const OUTSIDER = person('outsider', 'Otto Outsider', 'owner')

export const FILLERS = [
  person('filler-1', 'Finn Fielding', 'member'),
  person('filler-2', 'Gwen Garza', 'member'),
  person('filler-3', 'Hugo Hale', 'member'),
  person('filler-4', 'Ivy Ingram', 'member'),
] as const

export const IN_ORGANIZATION = [OWNER, ADMIN, MEMBER, CONNECTED, NARROW, ...FILLERS] as const
export const EVERYONE = [...IN_ORGANIZATION, OUTSIDER] as const

export const STANDARD_GROUP_ID = 'org-redesign-group-standard'
export const NARROW_GROUP_ID = 'org-redesign-group-narrow'
export const FULL_GROUP_ID = 'org-redesign-group-full'

/** The shape of the group most members belong to. */
export const STANDARD_GROUP_CONFIG = {
  disableInvitations: true,
  disableToolAutoApproval: true,
  disableLogExport: true,
  disablePublicApi: true,
  hideInboxTab: true,
  disablePersonalCredentials: false,
  disableWorkspaceCreation: false,
  hideOrgMemberDirectory: false,
  deniedModels: ['claude-opus-4-5', 'claude-fable-1'],
  allowedIntegrations: [
    'gmail_v2',
    'google_calendar_v2',
    'google_drive',
    'slack_v2',
    'jira',
    'confluence_v2',
    'gitlab',
    'zoom',
  ],
  allowedKnowledgeConnectors: ['confluence', 'gitlab', 'slack', 'jira', 'jsm'],
}

export const NARROW_GROUP_CONFIG = {
  ...STANDARD_GROUP_CONFIG,
  allowedIntegrations: ['slack', 'slack_v2', 'managed_agent', 'api'],
  allowedKnowledgeConnectors: ['slack'],
}

/** Approved search sources; only `coda` and `lucid` hold a live-search policy. */
export const APPROVED_SOURCES = [
  'gmail',
  'google_calendar',
  'google_drive',
  'jira',
  'slack',
  'confluence',
  'gitlab',
  'coda',
  'lucid',
] as const

/** Credential group options a member can connect through. No Microsoft provider is on offer. */
export const CONNECTABLE_PROVIDERS = [
  'gmail',
  'google-calendar',
  'google-drive',
  'jira',
  'confluence',
] as const

export const GRANTS = {
  gmail: { credentialId: 'org-redesign-grant-gmail', providerId: 'google-email' },
  'google-calendar': {
    credentialId: 'org-redesign-grant-google-calendar',
    providerId: 'google-calendar',
  },
} as const

const workspaceId = (slug: string) => `org-redesign-workspace-${slug}`

/** More than one page of the rail's list, so its paging is on for an admin. */
export const WORKSPACES = [
  { id: workspaceId('operations'), name: 'Operations' },
  { id: workspaceId('marketing'), name: 'Marketing' },
  { id: workspaceId('service'), name: 'Service Desk' },
  { id: workspaceId('parts'), name: 'Parts Catalog' },
  { id: workspaceId('finance'), name: 'Finance' },
  { id: workspaceId('fleet'), name: 'Fleet' },
  { id: workspaceId('training'), name: 'Training' },
] as const
export const MEMBER_ADMIN_WORKSPACE = WORKSPACES[0]
export const MEMBER_WRITE_WORKSPACE = WORKSPACES[1]

const uuid = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`

/** The member's chats: assistant ones live under Search, and an agent one they can no longer open. */
export const MEMBER_CHATS = {
  assistant: { id: uuid('1'), title: 'Warranty coverage', mode: 'assistant', seen: true },
  unread: { id: uuid('2'), title: 'Dealer onboarding', mode: 'assistant', seen: false },
  removable: { id: uuid('3'), title: 'Old parts question', mode: 'assistant', seen: true },
  bulkOne: { id: uuid('4'), title: 'Bulk removal one', mode: 'assistant', seen: true },
  bulkTwo: { id: uuid('5'), title: 'Bulk removal two', mode: 'assistant', seen: true },
  agent: { id: uuid('6'), title: 'Agent from before', mode: 'agent', seen: true },
} as const

export const ADMIN_CHATS = {
  agent: { id: uuid('7'), title: 'Quarterly review', mode: 'agent', seen: true },
  assistant: { id: uuid('8'), title: 'Vendor renewals', mode: 'assistant', seen: false },
  deleted: { id: uuid('9'), title: 'Retired plan', mode: 'agent', seen: true },
} as const

/** Recognizable rows in the 183, beside the numbered ones. */
export const NAMED_LINKS = {
  handbook: { name: 'handbook', url: 'https://example.com/handbook', description: 'The handbook' },
  restricted: { name: 'payroll', url: 'https://payroll.example.com', description: 'Pay stubs' },
  unlisted: { name: 'skunkworks', url: 'https://skunk.example.com', description: 'Quiet project' },
  variable: {
    name: 'ticket',
    url: 'https://tickets.example.com/browse/{*}',
    description: 'Open a ticket',
  },
  mostUsed: { name: 'timesheet', url: 'https://time.example.com', description: 'Weekly hours' },
} as const

export const SEEDED_SOURCE = {
  url: 'https://docs.example.com/service-bulletin',
  title: 'Service bulletin',
  query: 'service bulletin',
}
