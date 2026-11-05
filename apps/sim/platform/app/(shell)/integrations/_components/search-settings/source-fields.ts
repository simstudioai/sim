export interface ScopeField {
  label: string
  placeholder?: string
  required?: boolean
  multiple?: boolean
  identity?: boolean
  pattern?: string
  choices?: string[]
}

const GOOGLE_FIELDS: ScopeField[] = [
  { label: 'Delegated administrator', placeholder: 'admin@example.com', required: true },
  { label: 'Workspace users', placeholder: 'All users', multiple: true },
]

export const SOURCE_FIELDS: Record<string, ScopeField[]> = {
  google_drive: [
    ...GOOGLE_FIELDS,
    { label: 'Folders', placeholder: 'All accessible folders', multiple: true },
    { label: 'File type', choices: ['All', 'Documents', 'Spreadsheets', 'Presentations', 'Text'] },
  ],
  gmail: [
    ...GOOGLE_FIELDS,
    { label: 'Labels', placeholder: 'All labels', multiple: true },
    {
      label: 'Date range',
      choices: [
        'All time',
        'Last 7 days',
        'Last 30 days',
        'Last 90 days',
        'Last 6 months',
        'Last year',
      ],
    },
    { label: 'Search query' },
    { label: 'Promotions', choices: ['Exclude', 'Include'] },
    { label: 'Social', choices: ['Exclude', 'Include'] },
  ],
  google_calendar: [
    ...GOOGLE_FIELDS,
    { label: 'Calendars', placeholder: 'primary', multiple: true },
    {
      label: 'Date range',
      choices: ['30 days each way', 'Past 30 days', 'Next 30 days', '90 days each way'],
    },
    { label: 'Search query' },
    { label: 'Attendee details', choices: ['Include', 'Exclude'] },
  ],
  confluence: [
    { label: 'Site', required: true },
    {
      label: 'Spaces',
      required: true,
      placeholder: 'Space keys or * for all spaces',
      multiple: true,
    },
    { label: 'Content type', choices: ['Pages', 'Blog posts', 'All content'] },
    { label: 'Content labels', multiple: true },
  ],
  coda: [
    { label: 'Documents', required: true, placeholder: 'Document IDs', multiple: true },
    { label: 'Enterprise organization ID' },
  ],
  github: [
    {
      label: 'Repository',
      placeholder: 'owner/repository',
      required: true,
      identity: true,
      pattern: '[\\w.\\-]+/[\\w.\\-]+',
    },
    { label: 'Directory prefix' },
    { label: 'File extensions', multiple: true },
  ],
  gitlab: [
    { label: 'GitLab host', placeholder: 'gitlab.com', required: true, identity: true },
    { label: 'Project', placeholder: 'group/project', required: true, identity: true },
    {
      label: 'Content',
      choices: [
        'Wiki and issues',
        'Code, wiki, issues and merge requests',
        'Code',
        'Wiki',
        'Issues',
        'Merge requests',
      ],
    },
    { label: 'Branch or tag' },
    { label: 'Directory prefix' },
    { label: 'File extensions', multiple: true },
    { label: 'Issue state', choices: ['All', 'Open', 'Closed'] },
    { label: 'Issue labels', multiple: true },
    { label: 'Issue milestone' },
  ],
}
