import { describe, expect, it } from 'vitest'
import { GitLabBlock } from './gitlab'

const block = GitLabBlock

describe('GitLabBlock access operations', () => {
  it('coerces the selected access level from the combobox string to an integer at execution time', () => {
    const addParams = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_add_member',
      resourceType: 'group',
      resourceId: '42',
      userId: '7',
      accessLevel: '40',
      expiresAt: '2026-12-31',
      memberRoleId: '5',
    })
    expect(addParams).toMatchObject({
      resourceType: 'group',
      resourceId: '42',
      userId: 7,
      accessLevel: 40,
      expiresAt: '2026-12-31',
      memberRoleId: 5,
    })
    expect(typeof addParams?.accessLevel).toBe('number')
  })

  it('accepts a runtime-resolved numeric 0 ("No access") on a required op', () => {
    // A reference can resolve to the number 0; a truthiness guard would wrongly
    // reject it as missing. It must pass and coerce to 0.
    const byZero = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_add_member',
      resourceType: 'group',
      resourceId: '42',
      userId: '7',
      accessLevel: 0,
    })
    expect(byZero).toMatchObject({ userId: 7, accessLevel: 0 })
    expect(byZero?.accessLevel).toBe(0)
  })

  it('sends a numeric 0 on optional ops instead of silently omitting it', () => {
    const approve = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_approve_access_request',
      resourceType: 'group',
      resourceId: '42',
      userId: '7',
      accessLevel: 0,
    })
    expect(approve?.accessLevel).toBe(0)

    const invite = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_update_invitation',
      resourceType: 'group',
      resourceId: '42',
      email: 'a@b.com',
      invitationAccessLevel: 0,
    })
    expect(invite?.accessLevel).toBe(0)
  })

  it('throws loudly when a resolved access level is not a valid GitLab level', () => {
    expect(() =>
      block.tools.config.params?.({
        accessToken: 'pat',
        operation: 'gitlab_add_member',
        resourceType: 'group',
        resourceId: '42',
        userId: '7',
        accessLevel: 'root',
      })
    ).toThrow(/access level/i)
  })

  it('sends admin:false so update user can demote an administrator', () => {
    const demote = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_update_user',
      userId: '9',
      userAdminIsAdmin: false,
    })
    expect(demote?.admin).toBe(false)

    // An untouched switch is undefined and must leave the admin flag unchanged.
    const untouched = block.tools.config.params?.({
      accessToken: 'pat',
      operation: 'gitlab_update_user',
      userId: '9',
    })
    expect(untouched?.admin).toBeUndefined()
  })
})

const blockParams = block.tools.config?.params
if (!blockParams) throw new Error('GitLab block has no params mapper')
const mapParams = blockParams

/** Runs the mapper the way a tool call does: model/stored args with no operation, which arrives in context. */
function mapToolCall(operation: string, args: Record<string, unknown>) {
  return mapParams({ accessToken: 'pat', ...args }, { operation })
}

describe('GitLabBlock mapper on tool calls', () => {
  it('maps values a tool row stored under block-only fields to the tool params', () => {
    expect(
      mapToolCall('gitlab_compare_branches', {
        projectId: 'g/p',
        compareFrom: 'main',
        compareTo: 'dev',
      })
    ).toMatchObject({ from: 'main', to: 'dev' })
    expect(mapToolCall('gitlab_search_users', { userSearch: 'jdoe' })).toMatchObject({
      search: 'jdoe',
    })
    expect(
      mapToolCall('gitlab_update_member', {
        resourceId: '42',
        userId: 7,
        memberAccessLevel: 'Maintainer',
      })
    ).toMatchObject({ accessLevel: 40, userId: 7 })
  })

  it("keeps the model's tool-named args when no block field is stored", () => {
    expect(
      mapToolCall('gitlab_compare_branches', { projectId: 42, from: 'v1', to: 'v2' })
    ).toMatchObject({ projectId: '42', from: 'v1', to: 'v2' })
    expect(
      mapToolCall('gitlab_create_user', {
        email: 'a@b.com',
        username: 'ab',
        name: 'A B',
        resetPassword: true,
      })
    ).toMatchObject({ email: 'a@b.com', username: 'ab', name: 'A B' })
    expect(
      mapToolCall('gitlab_update_member', { resourceId: '42', userId: 7, accessLevel: 30 })
    ).toMatchObject({ accessLevel: 30 })
    expect(
      mapToolCall('gitlab_list_issues', { projectId: '1', issueState: 'all', state: 'closed' })
    ).toMatchObject({ state: 'closed' })
  })

  it('accepts the typed arrays and booleans a model sends', () => {
    expect(
      mapToolCall('gitlab_create_issue', { projectId: '1', title: 'Bug', assigneeIds: [3, 4] })
    ).toMatchObject({ assigneeIds: [3, 4] })
    expect(
      mapToolCall('gitlab_create_release', {
        projectId: '1',
        tagName: 'v1',
        milestones: ['M1', 'M2'],
      })
    ).toMatchObject({ milestones: ['M1', 'M2'] })
    expect(
      mapToolCall('gitlab_create_pipeline', {
        projectId: '1',
        ref: 'main',
        variables: { FOO: 1 },
      })
    ).toMatchObject({ variables: [{ key: 'FOO', value: '1' }] })
    expect(
      mapToolCall('gitlab_create_merge_request', {
        projectId: '1',
        title: 'T',
        sourceBranch: 'a',
        targetBranch: 'b',
        squash: false,
      })?.squash
    ).toBe(false)
  })

  it('does not apply tool-named fallbacks on the canvas', () => {
    const canvas = mapParams({
      accessToken: 'pat',
      operation: 'gitlab_list_merge_requests',
      projectId: '1',
      sourceBranch: 'stale-create-mr-value',
    })
    expect(canvas?.sourceBranch).toBeUndefined()
  })

  it('keeps create-only advanced values saved under another operation off update and merge requests', () => {
    const canvas = (operation: string, extra: Record<string, unknown>) =>
      mapParams({
        accessToken: 'pat',
        operation,
        projectId: '1',
        issueIid: '2',
        mergeRequestIid: '3',
        ...extra,
      })
    const updateIssue = canvas('gitlab_update_issue', { confidential: true, dueDate: '2026-12-31' })
    expect(updateIssue).toHaveProperty('confidential', undefined)
    expect(updateIssue).toHaveProperty('dueDate', undefined)
    expect(canvas('gitlab_update_merge_request', { draft: false })).toHaveProperty(
      'draft',
      undefined
    )
    expect(canvas('gitlab_merge_merge_request', { sha: 'stale-approve-sha' })).toHaveProperty(
      'sha',
      undefined
    )
    expect(canvas('gitlab_merge_merge_request', { mergeSha: 'abc123' })).toMatchObject({
      sha: 'abc123',
    })
  })

  it("passes the model's update and merge values through on tool calls", () => {
    expect(
      mapToolCall('gitlab_update_issue', {
        projectId: '1',
        issueIid: 2,
        confidential: false,
        dueDate: '2026-12-31',
      })
    ).toMatchObject({ confidential: false, dueDate: '2026-12-31' })
    expect(
      mapToolCall('gitlab_update_merge_request', {
        projectId: '1',
        mergeRequestIid: 3,
        draft: true,
      })
    ).toMatchObject({ draft: true })
    expect(
      mapToolCall('gitlab_merge_merge_request', { projectId: '1', mergeRequestIid: 3, sha: 'abc' })
    ).toMatchObject({ sha: 'abc' })
  })

  it("keeps the model's explicit opt-outs and milestone unassign on tool calls", () => {
    expect(
      mapToolCall('gitlab_merge_merge_request', {
        projectId: '1',
        mergeRequestIid: 3,
        squash: false,
        shouldRemoveSourceBranch: false,
      })
    ).toMatchObject({ squash: false, shouldRemoveSourceBranch: false })
    expect(
      mapToolCall('gitlab_update_issue', { projectId: '1', issueIid: 2, milestoneId: 0 })
    ).toMatchObject({ milestoneId: 0 })
    expect(
      mapToolCall('gitlab_update_merge_request', {
        projectId: '1',
        mergeRequestIid: 3,
        milestoneId: 0,
      })
    ).toMatchObject({ milestoneId: 0 })
    expect(mapToolCall('gitlab_list_groups', { allAvailable: false })).toMatchObject({
      allAvailable: false,
    })
  })

  it("keeps the model's empty string that clears a field on tool calls", () => {
    expect(
      mapToolCall('gitlab_update_issue', {
        projectId: '1',
        issueIid: 2,
        labels: '',
        description: '',
      })
    ).toMatchObject({ labels: '', description: '' })
    expect(
      mapToolCall('gitlab_update_merge_request', {
        projectId: '1',
        mergeRequestIid: 3,
        labels: '',
        assigneeIds: '',
      })
    ).toMatchObject({ labels: '', assigneeIds: '' })
    expect(
      mapToolCall('gitlab_update_member', {
        resourceId: '1',
        userId: 7,
        accessLevel: 30,
        expiresAt: '',
      })
    ).toMatchObject({ expiresAt: '' })
    expect(
      mapToolCall('gitlab_update_invitation', {
        resourceId: '1',
        email: 'a@b.c',
        accessLevel: 30,
        expiresAt: '',
      })
    ).toMatchObject({ accessLevel: 30, expiresAt: '' })
    expect(
      mapToolCall('gitlab_update_invitation', {
        resourceId: '1',
        email: 'a@b.c',
        expiresAt: '',
      })
    ).toMatchObject({ expiresAt: '' })
  })

  it('leaves a blank canvas field unsent on update operations', () => {
    const result = mapParams({
      accessToken: 'pat',
      operation: 'gitlab_update_issue',
      projectId: '1',
      issueIid: 2,
      labels: '',
      description: '',
    })
    expect(result?.labels).toBeUndefined()
    expect(result?.description).toBeUndefined()
  })
})
