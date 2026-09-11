/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { gitLabCsvSubjects, parseGitLabCsv } from '@/connectors/gitlab/permission-config/parser'
import { GITLAB_CSV_MAX_BYTES } from '@/connectors/gitlab/permission-config/types'

describe('GitLab CSV permission uploads', () => {
  it('accepts templates, headerless rows, BOM, CRLF, quotes and identical duplicates', () => {
    expect(
      parseGitLabCsv(
        {
          filename: 'users.csv',
          content: '\uFEFFuser_id,email\r\n"12", "Alice@Example.com"\r\n12,alice@example.com',
        },
        'userMapping'
      )
    ).toEqual([['12', 'alice@example.com']])
    expect(
      parseGitLabCsv(
        { filename: 'projects.csv', content: 'org/group/project,12\norg/group/project,12' },
        'projectPermissions'
      )
    ).toEqual([['org/group/project', '12']])
  })
  it.each([
    ['1,a@example.com\n1,b@example.com', 'conflicts'],
    ['1,a@example.com\n2,A@example.com', 'conflicts'],
    ['-1,a@example.com', 'user_id'],
    ['9007199254740992,a@example.com', 'user_id'],
    ['user_id,email\n', 'at least one'],
    ['', 'at least one'],
    ['1,', 'email'],
    ['1,not-an-email', 'email'],
    ['1,a@example.com,extra', 'two columns'],
    ['1,"a@example.com', 'Malformed CSV'],
    ['1,a@example.com\n2', 'Malformed CSV'],
  ])('rejects malformed or conflicting mappings without echoing cells: %s', (content, message) => {
    expect(() => parseGitLabCsv({ filename: 'users.csv', content }, 'userMapping')).toThrow(message)
    try {
      parseGitLabCsv({ filename: 'users.csv', content }, 'userMapping')
    } catch (error) {
      expect(String(error)).not.toContain('a@example.com')
    }
  })
  it('rejects malformed project rows and unsafe filenames', () => {
    for (const content of [
      'project_path,user_id\n',
      '../project,1',
      'group/project,',
      'group/project,no',
    ]) {
      expect(() =>
        parseGitLabCsv({ filename: 'projects.csv', content }, 'projectPermissions')
      ).toThrow()
    }
    expect(() =>
      parseGitLabCsv({ filename: '../users.csv', content: '1,a@example.com' }, 'userMapping')
    ).toThrow('filename')
  })
  it('requires an exact selected project and mapping; unrelated rows and unknown users grant nothing', () => {
    expect(
      gitLabCsvSubjects(
        [
          ['1', 'a@example.com'],
          ['2', 'b@example.com'],
        ],
        [
          ['group/project', '1'],
          ['group/other', '2'],
          ['group/project', '99'],
        ],
        'group/project'
      )
    ).toEqual(['u:a@example.com'])
  })
  it('checks UTF-8 bytes, not just string length', () => {
    expect(() =>
      parseGitLabCsv(
        { filename: 'users.csv', content: '😀'.repeat(GITLAB_CSV_MAX_BYTES / 4 + 1) },
        'userMapping'
      )
    ).toThrow('4 MiB')
  })
  it('accepts 100,000 rows and rejects the next row', () => {
    const content = Array.from({ length: 100_000 }, (_, i) => `${i + 1},u${i}@example.com`).join(
      '\n'
    )
    expect(parseGitLabCsv({ filename: 'users.csv', content }, 'userMapping')).toHaveLength(100_000)
    expect(() =>
      parseGitLabCsv(
        { filename: 'users.csv', content: `${content}\n100001,last@example.com` },
        'userMapping'
      )
    ).toThrow('100,000')
  })
})
