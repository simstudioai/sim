/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { GitHubBlock } from '@/blocks/blocks/github'
import { listWorkflowRunsTool, listWorkflowRunsV2Tool } from '@/tools/github/list_workflow_runs'
import {
  updateBranchProtectionTool,
  updateBranchProtectionV2Tool,
} from '@/tools/github/update_branch_protection'
import { validateRequiredParametersAfterMerge } from '@/tools/utils'

vi.unmock('@/tools/registry')

const BASE_PROTECTION_PARAMS = {
  owner: 'sim',
  repo: 'sim',
  branch: 'main',
  apiKey: 'token',
}

/** The four body fields GitHub documents as "required" but nullable. */
const NULLABLE_BODY_FIELDS = [
  'required_status_checks',
  'enforce_admins',
  'required_pull_request_reviews',
  'restrictions',
] as const

const buildProtectionBody = (params: Record<string, unknown>) =>
  updateBranchProtectionTool.request.body?.(params as never) as Record<string, unknown>

const buildRunsUrl = (params: Record<string, unknown>) => {
  const url = listWorkflowRunsTool.request.url
  return typeof url === 'function' ? url(params as never) : url
}

describe('github_update_branch_protection required modelling', () => {
  it.each(NULLABLE_BODY_FIELDS)('declares %s optional so the call can be made', (field) => {
    expect(updateBranchProtectionTool.params[field].required).toBe(false)
  })

  it('exposes restrictions as a declared param', () => {
    expect(updateBranchProtectionTool.params.restrictions).toBeDefined()
  })

  it('passes merge-time required validation with only owner/repo/branch supplied', () => {
    expect(() =>
      validateRequiredParametersAfterMerge(
        updateBranchProtectionTool.id,
        updateBranchProtectionTool as never,
        BASE_PROTECTION_PARAMS
      )
    ).not.toThrow()
  })

  it('shares the fixed params and request with the v2 tool', () => {
    expect(updateBranchProtectionV2Tool.params).toBe(updateBranchProtectionTool.params)
    expect(updateBranchProtectionV2Tool.request).toBe(updateBranchProtectionTool.request)
  })
})

describe('github_update_branch_protection body builder', () => {
  it('emits an explicit null for every field left unset', () => {
    const body = buildProtectionBody(BASE_PROTECTION_PARAMS)
    for (const field of NULLABLE_BODY_FIELDS) {
      expect(body).toHaveProperty(field)
      expect(body[field]).toBeNull()
    }
  })

  it('emits null rather than dropping a field left blank by the editor', () => {
    const body = buildProtectionBody({
      ...BASE_PROTECTION_PARAMS,
      required_status_checks: '',
      enforce_admins: '',
      required_pull_request_reviews: '',
      restrictions: '',
    })
    for (const field of NULLABLE_BODY_FIELDS) {
      expect(body[field]).toBeNull()
    }
  })

  it('parses the JSON strings the short-input subBlocks produce', () => {
    const body = buildProtectionBody({
      ...BASE_PROTECTION_PARAMS,
      required_status_checks: '{"strict":true,"contexts":["ci/test"]}',
      required_pull_request_reviews: '{"required_approving_review_count":2}',
      restrictions: '{"users":["octocat"],"teams":["admins"]}',
    })
    expect(body.required_status_checks).toEqual({ strict: true, contexts: ['ci/test'] })
    expect(body.required_pull_request_reviews).toEqual({ required_approving_review_count: 2 })
    expect(body.restrictions).toEqual({ users: ['octocat'], teams: ['admins'] })
  })

  it('passes already-structured objects through untouched', () => {
    const restrictions = { users: [], teams: [], apps: ['dependabot'] }
    const body = buildProtectionBody({ ...BASE_PROTECTION_PARAMS, restrictions })
    expect(body.restrictions).toEqual(restrictions)
  })

  it('rejects a non-object JSON value instead of shipping it to GitHub', () => {
    expect(() =>
      buildProtectionBody({ ...BASE_PROTECTION_PARAMS, restrictions: '["octocat"]' })
    ).toThrow(/JSON objects/)
  })

  it("coerces the dropdown's 'true'/'false' strings to booleans", () => {
    expect(
      buildProtectionBody({ ...BASE_PROTECTION_PARAMS, enforce_admins: 'true' }).enforce_admins
    ).toBe(true)
    expect(
      buildProtectionBody({ ...BASE_PROTECTION_PARAMS, enforce_admins: 'false' }).enforce_admins
    ).toBe(false)
  })

  it('preserves a real boolean false rather than treating it as unset', () => {
    expect(
      buildProtectionBody({ ...BASE_PROTECTION_PARAMS, enforce_admins: false }).enforce_admins
    ).toBe(false)
  })
})

describe('github_list_workflow_runs workflow_id', () => {
  it('declares an optional workflow_id param', () => {
    expect(listWorkflowRunsTool.params.workflow_id).toBeDefined()
    expect(listWorkflowRunsTool.params.workflow_id.required).toBe(false)
  })

  it('targets the per-workflow endpoint when a workflow id is supplied', () => {
    expect(buildRunsUrl({ owner: 'sim', repo: 'sim', workflow_id: 'ci.yml' })).toBe(
      'https://api.github.com/repos/sim/sim/actions/workflows/ci.yml/runs'
    )
  })

  it('accepts a numeric workflow id', () => {
    expect(buildRunsUrl({ owner: 'sim', repo: 'sim', workflow_id: 123456 })).toBe(
      'https://api.github.com/repos/sim/sim/actions/workflows/123456/runs'
    )
  })

  it('keeps query filters on the per-workflow endpoint', () => {
    const url = buildRunsUrl({
      owner: 'sim',
      repo: 'sim',
      workflow_id: 'ci.yml',
      branch: 'main',
      status: 'completed',
      per_page: 50,
    })
    expect(url).toContain('/actions/workflows/ci.yml/runs?')
    expect(url).toContain('branch=main')
    expect(url).toContain('status=completed')
    expect(url).toContain('per_page=50')
  })

  it.each([undefined, null, '', '   '])(
    'falls back to the repository-wide endpoint for %p',
    (workflow_id) => {
      expect(buildRunsUrl({ owner: 'sim', repo: 'sim', workflow_id })).toBe(
        'https://api.github.com/repos/sim/sim/actions/runs'
      )
    }
  )

  it('escapes a workflow id so it cannot break out of its path segment', () => {
    expect(buildRunsUrl({ owner: 'sim', repo: 'sim', workflow_id: 'a/../b' })).toContain(
      '/actions/workflows/a%2F..%2Fb/runs'
    )
  })

  it('shares the wired request with the v2 tool', () => {
    expect(listWorkflowRunsV2Tool.request).toBe(listWorkflowRunsTool.request)
    expect(listWorkflowRunsV2Tool.params).toBe(listWorkflowRunsTool.params)
  })
})

describe('github block wiring', () => {
  const subBlocks = GitHubBlock.subBlocks

  it('renders a restrictions subBlock scoped to update branch protection', () => {
    const restrictions = subBlocks.filter((sub) => sub.id === 'restrictions')
    expect(restrictions).toHaveLength(1)
    expect(restrictions[0].condition).toEqual({
      field: 'operation',
      value: 'github_update_branch_protection',
    })
  })

  it('declares the JSON protection fields as json inputs so they are parsed', () => {
    for (const field of [
      'required_status_checks',
      'required_pull_request_reviews',
      'restrictions',
    ]) {
      expect(GitHubBlock.inputs[field]).toEqual(expect.objectContaining({ type: 'json' }))
    }
  })

  it('renders workflow_id for the operation whose tool now reads it', () => {
    const listRunsWorkflowId = subBlocks.find(
      (sub) =>
        sub.id === 'workflow_id' &&
        JSON.stringify(sub.condition).includes('github_list_workflow_runs')
    )
    expect(listRunsWorkflowId).toBeDefined()
    expect(listWorkflowRunsTool.params.workflow_id).toBeDefined()
  })

  /**
   * `shouldSerializeSubBlock` (serializer/index.ts:91-93) serializes a non-empty
   * `mode: 'advanced'` field without evaluating its condition, so values entered
   * under one operation are still in `params` after the user switches operations.
   */
  it('does not let a stale advanced value from another operation reach the mapper output', () => {
    const stale = {
      operation: 'github_update_branch_protection',
      restrictions: '{"users":["octocat"],"teams":[]}',
      milestone_title: 'Stale milestone left over from Create Milestone',
      milestone_description: 'Stale description',
      gist_public: 'true',
      fork_name: 'stale-fork',
      reaction_content: '+1',
    }
    const mapped = GitHubBlock.tools.config?.params?.(stale) ?? {}
    expect(mapped).toEqual({})
  })

  it('does not let a stale branch-protection value reach an unrelated operation', () => {
    const stale = {
      operation: 'github_create_issue',
      restrictions: '{"users":["octocat"],"teams":[]}',
      enforce_admins: 'true',
      required_status_checks: '{"strict":true,"contexts":[]}',
      workflow_id: 'ci.yml',
      milestone_title: 'Stale milestone title',
    }
    const mapped = GitHubBlock.tools.config?.params?.(stale) ?? {}
    expect(mapped).toEqual({})
  })

  it('still maps an alias for the operation that owns it', () => {
    const mapped = GitHubBlock.tools.config?.params?.({
      operation: 'github_create_milestone',
      milestone_title: 'v1.0',
    })
    expect(mapped).toEqual({ title: 'v1.0' })
  })

  /**
   * `generic-handler.ts` merges `{ ...inputs, ...params(inputs) }` and
   * `providers/utils.ts` installs this same function as the provider
   * `paramsTransform`, spreading it over the model's tool-call arguments. Emitting
   * a key the block did not supply would overwrite a model-supplied value with
   * `undefined`, so an unset source must produce no key at all — not an undefined
   * one. `toEqual` treats an undefined-valued key as absent, so this asserts on
   * the key list.
   */
  it.each([
    ['github_create_milestone', 'milestone_title', 'title'],
    ['github_create_milestone', 'milestone_description', 'description'],
    ['github_list_milestones', 'milestone_state', 'state'],
    ['github_fork_repo', 'fork_name', 'name'],
    ['github_create_gist', 'gist_public', 'public'],
    ['github_create_issue_reaction', 'reaction_content', 'content'],
  ])('emits no %s key for an unset %s source', (operation, source, target) => {
    for (const unset of [undefined, null, '']) {
      const mapped = GitHubBlock.tools.config?.params?.({ operation, [source]: unset }) ?? {}
      expect(Object.keys(mapped)).not.toContain(target)
    }
    const omitted = GitHubBlock.tools.config?.params?.({ operation }) ?? {}
    expect(Object.keys(omitted)).toHaveLength(0)
  })

  it('preserves a deliberate false rather than treating it as unset', () => {
    const mapped = GitHubBlock.tools.config?.params?.({
      operation: 'github_create_gist',
      gist_public: 'false',
    })
    expect(mapped).toEqual({ public: false })
  })
})
