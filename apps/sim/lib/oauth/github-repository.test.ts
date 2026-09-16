/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { parseGitHubRepository } from '@/lib/oauth/github-repository'

describe('parseGitHubRepository', () => {
  it.each([
    'owner/repo',
    ' owner/repo ',
    'owner/repo.git',
    'owner/repo.git/',
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git/',
    'HTTP://GITHUB.COM/owner/repo/',
  ])('normalizes %s to the same repository', (repository) => {
    expect(parseGitHubRepository(repository)).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it.each([
    '',
    'owner',
    'owner/repo/extra',
    'owner/.',
    'owner/..',
    'owner/../repo',
    'owner/%2e%2e',
    'owner/repo%2fextra',
    'owner/repo?redirect=https://example.com',
    'owner/repo#fragment',
    'owner\\repo',
    '//github.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://github.com@evil.example/owner/repo',
    'https://evil.example@github.com/owner/repo',
    'https://github.com:443/owner/repo',
    'https://127.0.0.1/owner/repo',
    'https://github.com/owner/repo/../../app',
    'https://github.com/owner/repo.git//',
    'git@github.com:owner/repo.git',
  ])('rejects invalid or unsafe repository reference %s', (repository) => {
    expect(() => parseGitHubRepository(repository)).toThrow('Invalid repository format')
  })
})
