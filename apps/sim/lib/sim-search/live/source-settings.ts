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

/**
 * Keep installation selectors in both backends and limit live settings to federated retrieval. Live
 * fields carry no description line: each placeholder already shows its format.
 */
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
            }
          : {}),
        description: undefined,
        descriptionInAdminMode: undefined,
      })),
  }
}
