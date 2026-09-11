interface SearchConnectionLabels {
  add: string
  title: string
  empty: string
  searchPlaceholder: string
}

const CONNECTION_LABELS: Record<string, SearchConnectionLabels> = {
  confluence: {
    add: 'Add Confluence site',
    title: 'Connect Confluence site',
    empty: 'No Confluence sites connected.',
    searchPlaceholder: 'Search Confluence sites...',
  },
  jira: {
    add: 'Add projects',
    title: 'Add Jira projects',
    empty: 'No Jira projects added.',
    searchPlaceholder: 'Search Jira projects...',
  },
  github: {
    add: 'Add repository',
    title: 'Add GitHub repository',
    empty: 'No GitHub repositories added.',
    searchPlaceholder: 'Search GitHub repositories...',
  },
  gitlab: {
    add: 'Add project',
    title: 'Add GitLab project',
    empty: 'No GitLab projects added.',
    searchPlaceholder: 'Search GitLab projects...',
  },
  slack: {
    add: 'Add channels or DMs',
    title: 'Choose Slack channels and DMs',
    empty: 'No Slack connections yet.',
    searchPlaceholder: 'Search Slack connections...',
  },
}
const GOOGLE_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  google_calendar: 'Google Calendar',
  google_drive: 'Google Drive',
}

/** Labels describe the connection being configured, not the internal connector record. */
export function getSearchConnectionLabels(
  connectorType: string,
  accessMode: 'admin' | 'members' | 'workspace' = 'admin'
): SearchConnectionLabels {
  const googleName = GOOGLE_NAMES[connectorType]
  if (googleName) {
    return {
      add: accessMode === 'members' ? 'Set up member accounts' : 'Connect service account',
      title:
        accessMode === 'members'
          ? `Set up ${googleName} member accounts`
          : `Connect ${googleName} service account`,
      empty: `No ${googleName} connections yet.`,
      searchPlaceholder: `Search ${googleName} connections...`,
    }
  }
  return (
    CONNECTION_LABELS[connectorType] ?? {
      add: 'Add connection',
      title: 'Add connection',
      empty: 'No connections yet.',
      searchPlaceholder: 'Search connections...',
    }
  )
}
