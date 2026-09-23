import type { ConnectorMeta } from '@/connectors/types'

const LIVE_SOURCE_FIELDS: Record<string, readonly string[]> = {
  google_drive: ['adminEmail', 'userEmails', 'folderSelector', 'folderId', 'fileType'],
  gmail: [
    'adminEmail',
    'userEmails',
    'labelSelector',
    'label',
    'dateRange',
    'query',
    'excludePromotions',
    'excludeSocial',
  ],
  google_calendar: [
    'adminEmail',
    'userEmails',
    'calendarSelector',
    'calendarId',
    'dateRange',
    'searchQuery',
    'includeAttendees',
  ],
  confluence: ['domain', 'spaceSelector', 'spaceKey', 'contentType', 'labelFilter'],
  coda: ['docSelector', 'docIds', 'organizationId'],
  github: ['repository', 'pathPrefix', 'extensions'],
  gitlab: [
    'host',
    'project',
    'contentTypes',
    'ref',
    'pathPrefix',
    'fileExtensions',
    'issueState',
    'issueLabels',
    'issueMilestone',
  ],
}

const LIVE_FIELD_DESCRIPTIONS: Record<string, Record<string, string | null>> = {
  google_drive: {
    userEmails: 'Optional; blank allows all Workspace users.',
    folderSelector: 'Selected folders and subfolders; blank allows all.',
    folderId: 'Selected folders and subfolders; blank allows all.',
  },
  gmail: {
    userEmails: 'Optional; blank allows all Workspace mailboxes.',
    labelSelector: 'Selected labels; blank allows all.',
    label: 'Use label names or system labels such as INBOX.',
  },
  google_calendar: {
    userEmails: 'Optional; blank allows all Workspace users.',
    calendarSelector: 'Primary means each member’s primary calendar.',
    calendarId: 'Primary means each member’s primary calendar.',
    searchQuery: 'Matches event text and attendee names.',
    includeAttendees: 'Include attendee details in results.',
  },
  coda: {
    docSelector: 'The picker shows opened documents; use IDs for others.',
    docIds: 'Use IDs for documents absent from the picker.',
    organizationId: 'Optional; validates documents against your Enterprise organization.',
  },
  gitlab: {
    host: 'Self-managed GitLab host.',
    project: null,
    contentTypes: 'Defaults to Wiki & Issues.',
    ref: 'Branch or tag for code; blank uses the default branch.',
    pathPrefix: 'Code files only.',
    fileExtensions: 'Code files only; separate extensions with commas.',
    issueState: null,
    issueLabels: 'All labels must match.',
    issueMilestone: 'Exact title.',
  },
  github: {
    repository: 'One repository per source.',
    pathPrefix: 'Code files only.',
    extensions: 'Code files only; separate extensions with commas.',
  },
}

/** Keep installation selectors in both backends and limit live settings to federated retrieval. */
export function liveSearchSourceMeta(
  meta: ConnectorMeta | null,
  enabled: boolean,
  options: { githubInstallation?: boolean } = {}
): ConnectorMeta | null {
  if (!meta) return meta
  if (meta.id === 'github' && options.githubInstallation) {
    meta = {
      ...meta,
      configFields: meta.configFields.map((field) =>
        field.id === 'repository'
          ? {
              ...field,
              type: 'selector',
              selectorKey: 'github.installationRepositories',
              placeholder: 'Select a repository',
            }
          : field
      ),
    }
  }
  if (!enabled) return meta
  const fields = LIVE_SOURCE_FIELDS[meta.id]
  if (!fields) return meta
  const descriptions = LIVE_FIELD_DESCRIPTIONS[meta.id] ?? {}
  return {
    ...meta,
    adminSetupHint: ['google_drive', 'gmail', 'google_calendar'].includes(meta.id)
      ? 'Requires a service account with domain-wide delegation.'
      : meta.id === 'coda'
        ? undefined
        : meta.adminSetupHint,
    configFields: meta.configFields
      .filter((field) => fields.includes(field.id))
      .map((field) => ({
        ...field,
        ...((field.id === 'labelSelector' && meta.id === 'gmail') ||
        (field.id === 'calendarSelector' && meta.id === 'google_calendar')
          ? { hideInAdminMode: undefined, dependsOn: ['adminEmail'] }
          : {}),
        ...(field.id === 'adminEmail'
          ? {
              title: 'Delegated administrator',
              titleInAdminMode: 'Delegated administrator',
              requiredInAdminMode: true,
              description: undefined,
              descriptionInAdminMode: undefined,
            }
          : {}),
        ...(Object.hasOwn(descriptions, field.id)
          ? {
              description: descriptions[field.id] ?? undefined,
              descriptionInAdminMode: descriptions[field.id] ?? undefined,
            }
          : {}),
      })),
  }
}
