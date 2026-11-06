export const GITLAB_TOKEN_TABS = [
  { value: 'administrator', label: 'Administrator token' },
  { value: 'csv', label: 'Non-admin token' },
] as const

export const GITLAB_CSV_FILES = {
  userMapping: {
    title: 'User mapping',
    filename: 'gitlab-users.csv',
    template: 'user_id,email\n123,alice@example.com\n',
  },
  projectPermissions: {
    title: 'Project permissions',
    filename: 'gitlab-project-permissions.csv',
    template: 'project_path,user_id\ngroup/project,123\n',
  },
} as const
