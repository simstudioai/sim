import { describe, expect, it } from 'vitest'
import { prepareGitLabPermissions } from '@/connectors/gitlab/permission-config/repository'

const files = {
  mode: 'csv' as const,
  userMapping: {
    filename: 'users.csv',
    content: 'user_id,email\n1,alice@example.com\n2,bob@example.com',
  },
  projectPermissions: {
    filename: 'permissions.csv',
    content: 'project_path,user_id\nteam/a,1\nteam/b,2',
  },
}
const group = {
  host: 'gitlab.example.com',
  group: { id: 7, path: 'team', includeSubgroups: false },
  projects: [
    { id: 11, path: 'team/a' },
    { id: 12, path: 'team/b' },
  ],
}

describe('GitLab permission snapshot boundaries', () => {
  it('rejects grants outside the discovered group without creating a partial snapshot', () => {
    expect(() =>
      prepareGitLabPermissions(
        {
          ...files,
          projectPermissions: {
            filename: 'permissions.csv',
            content: 'project_path,user_id\nteam/a,1\nother/private,2',
          },
        },
        group,
        null,
        false
      )
    ).toThrow('outside')
  })
  it('does not transfer grants when a project path is reused', () => {
    const initial = prepareGitLabPermissions(files, group, null, false)
    expect(() =>
      prepareGitLabPermissions(
        { ...files, expectedRevision: 1 },
        {
          ...group,
          projects: [
            { id: 99, path: 'team/a' },
            { id: 12, path: 'team/b' },
          ],
        },
        initial.snapshot,
        true
      )
    ).toThrow('identity')
  })
})
