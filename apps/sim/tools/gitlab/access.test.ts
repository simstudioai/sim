/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { gitlabAddMemberTool } from '@/tools/gitlab/add_member'
import { gitlabApproveAccessRequestTool } from '@/tools/gitlab/approve_access_request'
import { gitlabInviteMemberTool } from '@/tools/gitlab/invite_member'
import { gitlabListMembersTool } from '@/tools/gitlab/list_members'
import { gitlabUpdateMemberTool } from '@/tools/gitlab/update_member'
import { gitlabBlockUserTool } from '@/tools/gitlab/user_status_actions'

interface MockResponseOptions {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
}

function mockResponse({
  ok = true,
  status = 200,
  json,
  text = '',
  headers = {},
}: MockResponseOptions): Response {
  return {
    ok,
    status,
    json: async () => json,
    text: async () => text,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as Response
}

const baseArgs = { accessToken: 'pat', resourceType: 'group' as const, resourceId: '42' }

describe('gitlab_list_members', () => {
  it('defaults to /members/all so inherited members are included', () => {
    const url = gitlabListMembersTool.request.url({ ...baseArgs })
    expect(url).toBe('https://gitlab.com/api/v4/groups/42/members/all')
  })

  it('uses /members when directOnly is set', () => {
    const url = gitlabListMembersTool.request.url({ ...baseArgs, directOnly: true })
    expect(url).toBe('https://gitlab.com/api/v4/groups/42/members')
  })

  it('builds a project path and forwards pagination', () => {
    const url = gitlabListMembersTool.request.url({
      ...baseArgs,
      resourceType: 'project',
      resourceId: 'grp/proj',
      perPage: 50,
      page: 2,
    })
    expect(url).toBe('https://gitlab.com/api/v4/projects/grp%2Fproj/members/all?per_page=50&page=2')
  })
})

describe('gitlab_add_member', () => {
  it('sends integer user_id and access_level in the body', () => {
    const body = gitlabAddMemberTool.request.body?.({
      ...baseArgs,
      userId: 7,
      accessLevel: 30,
      expiresAt: '2026-12-31',
      memberRoleId: 5,
    })
    expect(body).toEqual({
      user_id: 7,
      access_level: 30,
      expires_at: '2026-12-31',
      member_role_id: 5,
    })
  })

  it('treats a 409 as a soft success so workflows are re-runnable', async () => {
    const result = await gitlabAddMemberTool.transformResponse!(
      mockResponse({
        ok: false,
        status: 409,
        json: { message: 'Member already exists' },
        text: '{"message":"Member already exists"}',
      }),
      {} as never
    )
    expect(result.success).toBe(true)
    expect(result.output.alreadyMember).toBe(true)
  })

  it('returns the created member on success', async () => {
    const result = await gitlabAddMemberTool.transformResponse!(
      mockResponse({ ok: true, status: 201, json: { id: 7, access_level: 30 } }),
      {} as never
    )
    expect(result.success).toBe(true)
    expect(result.output.alreadyMember).toBe(false)
    expect(result.output.member).toEqual({ id: 7, access_level: 30 })
  })

  it('surfaces a 409 that is not an already-member conflict as a failure', async () => {
    const result = await gitlabAddMemberTool.transformResponse!(
      mockResponse({ ok: false, status: 409, text: '{"message":"Seat limit reached"}' }),
      {} as never
    )
    expect(result.success).toBe(false)
  })

  it('surfaces other errors as hard failures', async () => {
    const result = await gitlabAddMemberTool.transformResponse!(
      mockResponse({ ok: false, status: 403, text: 'Forbidden' }),
      {} as never
    )
    expect(result.success).toBe(false)
  })
})

describe('gitlab_update_member', () => {
  it('sends the new access_level integer and expires_at', () => {
    const body = gitlabUpdateMemberTool.request.body?.({
      ...baseArgs,
      userId: 7,
      accessLevel: 40,
      expiresAt: '2027-01-01',
    })
    expect(body).toEqual({ access_level: 40, expires_at: '2027-01-01' })
  })
})

describe('gitlab_approve_access_request', () => {
  it('passes the granted access_level as an integer query param', () => {
    const url = gitlabApproveAccessRequestTool.request.url({
      ...baseArgs,
      userId: 7,
      accessLevel: 40,
    })
    expect(url).toBe(
      'https://gitlab.com/api/v4/groups/42/access_requests/7/approve?access_level=40'
    )
  })

  it('omits access_level when not provided (GitLab defaults to Developer)', () => {
    const url = gitlabApproveAccessRequestTool.request.url({ ...baseArgs, userId: 7 })
    expect(url).toBe('https://gitlab.com/api/v4/groups/42/access_requests/7/approve')
  })
})

describe('gitlab_invite_member', () => {
  it('reports a per-email failure even when GitLab returns 200 with status:error', async () => {
    const result = await gitlabInviteMemberTool.transformResponse!(
      mockResponse({
        ok: true,
        status: 201,
        json: { status: 'error', message: { 'a@b.com': 'Already invited' } },
      }),
      {} as never
    )
    expect(result.success).toBe(false)
    expect(result.output.status).toBe('error')
  })

  it('reports success when GitLab accepts the invite', async () => {
    const result = await gitlabInviteMemberTool.transformResponse!(
      mockResponse({ ok: true, status: 201, json: { status: 'success' } }),
      {} as never
    )
    expect(result.success).toBe(true)
    expect(result.output.status).toBe('success')
  })
})

describe('gitlab_invite_member email normalization', () => {
  it('normalizes a comma-separated list with spaces into GitLab-accepted form', () => {
    const body = gitlabInviteMemberTool.request.body?.({
      ...baseArgs,
      email: 'alice@example.com, bob@example.com',
      accessLevel: 30,
    }) as Record<string, unknown>
    expect(body.email).toBe('alice@example.com,bob@example.com')
  })

  it('passes a single email through unchanged', () => {
    const body = gitlabInviteMemberTool.request.body?.({
      ...baseArgs,
      email: 'alice@example.com',
      accessLevel: 30,
    }) as Record<string, unknown>
    expect(body.email).toBe('alice@example.com')
  })
})

describe('gitlab user status actions', () => {
  it('returns success with no user object when GitLab responds with a bare true', async () => {
    const result = await gitlabBlockUserTool.transformResponse!(
      mockResponse({ ok: true, status: 201, json: true }),
      {} as never
    )
    expect(result.success).toBe(true)
    expect(result.output.success).toBe(true)
    expect(result.output.user).toBeUndefined()
  })

  it('surfaces the updated user object when GitLab returns one', async () => {
    const result = await gitlabBlockUserTool.transformResponse!(
      mockResponse({ ok: true, status: 201, json: { id: 9, state: 'blocked' } }),
      {} as never
    )
    expect(result.success).toBe(true)
    expect(result.output.user).toEqual({ id: 9, state: 'blocked' })
  })
})
