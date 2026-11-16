import { describe, expect, it } from 'vitest'
import { gitlabDeleteBranchTool } from '@/tools/gitlab/delete_branch'
import { gitlabDeleteIssueTool } from '@/tools/gitlab/delete_issue'
import { gitlabDeleteSamlGroupLinkTool } from '@/tools/gitlab/delete_saml_group_link'
import { gitlabDeleteUserIdentityTool } from '@/tools/gitlab/delete_user_identity'
import { gitlabGetProjectTool } from '@/tools/gitlab/get_project'
import { gitlabMergeMergeRequestTool } from '@/tools/gitlab/merge_merge_request'
import { gitlabRevokeInvitationTool } from '@/tools/gitlab/revoke_invitation'
import { gitlabUpdateInvitationTool } from '@/tools/gitlab/update_invitation'

function urlOf(tool: { request: { url: unknown } }, params: Record<string, unknown>): string {
  const { url } = tool.request
  if (typeof url !== 'function') throw new Error('expected a URL builder')
  return url(params)
}

describe('gitlab project-scoped request paths', () => {
  it('encodes a pre-encoded namespaced project path exactly once', () => {
    expect(urlOf(gitlabGetProjectTool, { projectId: 'my-group%2Fmy-project' })).toBe(
      'https://gitlab.com/api/v4/projects/my-group%2Fmy-project'
    )
  })

  it('rejects an issue IID that would steer the request to another endpoint', () => {
    expect(() =>
      urlOf(gitlabDeleteIssueTool, { projectId: 'g/p', issueIid: '1/../../../../users/7' })
    ).toThrow(/issueIid/)
    expect(() => urlOf(gitlabGetProjectTool, { projectId: '..' })).toThrow()
  })

  it('rejects a dot-segment name that would retarget a DELETE to its parent resource', () => {
    const scoped = { resourceType: 'project', resourceId: '42' }
    expect(() => urlOf(gitlabRevokeInvitationTool, { ...scoped, email: '..' })).toThrow(/email/)
    expect(() => urlOf(gitlabUpdateInvitationTool, { ...scoped, email: ' .. ' })).toThrow(/email/)
    expect(() =>
      urlOf(gitlabDeleteSamlGroupLinkTool, { groupId: '5', samlGroupName: '..' })
    ).toThrow(/samlGroupName/)
    expect(() => urlOf(gitlabDeleteUserIdentityTool, { userId: 7, provider: '..' })).toThrow(
      /provider/
    )
    expect(() => urlOf(gitlabDeleteBranchTool, { projectId: '1', branch: '.' })).toThrow(/branch/)
  })

  it('still encodes names that contain a slash or dots', () => {
    expect(urlOf(gitlabDeleteSamlGroupLinkTool, { groupId: '5', samlGroupName: 'eng/devs' })).toBe(
      'https://gitlab.com/api/v4/groups/5/saml_group_links/eng%2Fdevs'
    )
    expect(urlOf(gitlabDeleteBranchTool, { projectId: '1', branch: 'feature/a..b' })).toBe(
      'https://gitlab.com/api/v4/projects/1/repository/branches/feature%2Fa..b'
    )
  })
})

describe('gitlab_merge_merge_request', () => {
  it('sends the head SHA that instances requiring it check', () => {
    const body = gitlabMergeMergeRequestTool.request.body?.({
      accessToken: 'pat',
      projectId: '1',
      mergeRequestIid: 2,
      sha: 'abc123',
    })
    expect(body).toMatchObject({ sha: 'abc123' })
  })
})
