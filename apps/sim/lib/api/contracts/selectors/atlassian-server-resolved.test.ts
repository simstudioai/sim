/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  confluenceSelectorPageBodySchema,
  confluenceSelectorPagesBodySchema,
  confluenceSpacesSelectorBodySchema,
} from '@/lib/api/contracts/selectors/confluence'
import { jiraIssuesBodySchema, jiraProjectsQuerySchema } from '@/lib/api/contracts/selectors/jira'

const credentialContext = {
  credential: 'credential-1',
  workflowId: 'workflow-1',
  domain: '{{DOMAIN}}',
}

describe('server-resolved Atlassian selector wire contracts', () => {
  it('accepts literal or exact-reference domains for Jira and Confluence selectors', () => {
    for (const domain of ['tenant.atlassian.net', '{{ATLASSIAN_DOMAIN}}']) {
      expect(jiraProjectsQuerySchema.safeParse({ ...credentialContext, domain }).success).toBe(true)
      expect(
        jiraIssuesBodySchema.safeParse({ ...credentialContext, domain, issueKeys: ['SIM-1'] })
          .success
      ).toBe(true)
      expect(
        confluenceSpacesSelectorBodySchema.safeParse({ ...credentialContext, domain }).success
      ).toBe(true)
      expect(
        confluenceSelectorPagesBodySchema.safeParse({ ...credentialContext, domain }).success
      ).toBe(true)
      expect(
        confluenceSelectorPageBodySchema.safeParse({
          ...credentialContext,
          domain,
          pageId: '1234',
        }).success
      ).toBe(true)
    }
  })

  it('allows workflowless credential-backed Jira and Confluence selector requests', () => {
    expect(
      jiraProjectsQuerySchema.safeParse({
        credential: 'credential-1',
        domain: '{{ATLASSIAN_DOMAIN}}',
      }).success
    ).toBe(true)
    expect(
      confluenceSpacesSelectorBodySchema.safeParse({
        credential: 'credential-1',
        domain: '{{ATLASSIAN_DOMAIN}}',
      }).success
    ).toBe(true)
  })
})
