/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { listWorkflowRunsTool } from '@/tools/github/list_workflow_runs'

const BASE = {
  owner: 'octocat',
  repo: 'hello-world',
  apiKey: 'token',
}

function urlFor(params: Record<string, unknown>): string {
  const build = listWorkflowRunsTool.request.url
  return typeof build === 'function' ? build(params as never) : build
}

describe('github_list_workflow_runs url', () => {
  it('lists runs across the repository when no workflow is named', () => {
    expect(urlFor(BASE)).toBe('https://api.github.com/repos/octocat/hello-world/actions/runs')
  })

  /**
   * The block renders a "Workflow ID or Filename" field for this operation, so
   * the scoped endpoint has to exist or that field silently widens the query to
   * every run in the repository.
   */
  it('scopes runs to one workflow when a workflow id is given', () => {
    expect(urlFor({ ...BASE, workflow_id: '42' })).toBe(
      'https://api.github.com/repos/octocat/hello-world/actions/workflows/42/runs'
    )
  })

  it('accepts a workflow filename', () => {
    expect(urlFor({ ...BASE, workflow_id: 'build_and_test.yml' })).toBe(
      'https://api.github.com/repos/octocat/hello-world/actions/workflows/build_and_test.yml/runs'
    )
  })

  /**
   * `list_workflows` surfaces `path` (`.github/workflows/ci.yml`), which is the
   * value an agent chains in. GitHub resolves that form only percent-encoded —
   * a real slash 404s.
   */
  it('percent-encodes a workflow path so the separator survives as one parameter', () => {
    expect(urlFor({ ...BASE, workflow_id: '.github/workflows/ci.yml' })).toBe(
      'https://api.github.com/repos/octocat/hello-world/actions/workflows/.github%2Fworkflows%2Fci.yml/runs'
    )
  })

  it('keeps the repository-wide endpoint for a blank workflow id', () => {
    expect(urlFor({ ...BASE, workflow_id: '   ' })).toBe(
      'https://api.github.com/repos/octocat/hello-world/actions/runs'
    )
  })

  it('still applies filters on the scoped endpoint', () => {
    const url = urlFor({ ...BASE, workflow_id: 'ci.yml', branch: 'main', status: 'completed' })

    expect(url).toContain('/actions/workflows/ci.yml/runs?')
    expect(url).toContain('branch=main')
    expect(url).toContain('status=completed')
  })
})
