import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraCreateIssueLinkParams {
  accessToken: string
  domain: string
  inwardIssueKey: string
  outwardIssueKey: string
  linkType: string
  comment?: string
  cloudId?: string
}

export interface JiraCreateIssueLinkResponse extends ToolResponse {
  output: {
    ts: string
    inwardIssue: string
    outwardIssue: string
    linkType: string
    linkId?: string
    success: boolean
  }
}

export const jiraCreateIssueLinkTool: ToolConfig<
  JiraCreateIssueLinkParams,
  JiraCreateIssueLinkResponse
> = {
  id: 'jira_create_issue_link',
  name: 'Jira Create Issue Link',
  description: 'Create a link relationship between two Jira issues',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    inwardIssueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key for the inward issue (e.g., PROJ-123)',
    },
    outwardIssueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key for the outward issue (e.g., PROJ-456)',
    },
    linkType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The type of link relationship (e.g., "Blocks", "Relates to", "Duplicates")',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment to add to the issue link',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (_params: JiraCreateIssueLinkParams) => {
      // Always discover first; actual POST happens in transformResponse
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: () => 'GET',
    headers: (params: JiraCreateIssueLinkParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: () => undefined as any,
  },

  transformResponse: async (response: Response, params?: JiraCreateIssueLinkParams) => {
    // Resolve cloudId
    const cloudId = params?.cloudId || (await getJiraCloudId(params!.domain, params!.accessToken))

    // Fetch and resolve link type by id/name/inward/outward (case-insensitive)
    const typesResp = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issueLinkType`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${params!.accessToken}` },
      }
    )
    if (!typesResp.ok) {
      throw new Error(`Failed to fetch issue link types (${typesResp.status})`)
    }
    const typesData = await typesResp.json()
    const provided = (params!.linkType || '').trim().toLowerCase()
    let resolvedType: { id?: string; name?: string } | undefined
    const allTypes = Array.isArray(typesData?.issueLinkTypes) ? typesData.issueLinkTypes : []
    for (const t of allTypes) {
      const name = String(t?.name || '').toLowerCase()
      const inward = String(t?.inward || '').toLowerCase()
      const outward = String(t?.outward || '').toLowerCase()
      if (provided && (provided === name || provided === inward || provided === outward)) {
        resolvedType = t?.id ? { id: String(t.id) } : { name: t?.name }
        break
      }
    }
    if (!resolvedType && /^\d+$/.test(provided)) {
      resolvedType = { id: provided }
    }
    if (!resolvedType) {
      const available = allTypes
        .map((t: any) => `${t?.name} (inward: ${t?.inward}, outward: ${t?.outward})`)
        .join('; ')
      throw new Error(`Unknown issue link type "${params!.linkType}". Available: ${available}`)
    }

    // Create issue link
    const linkUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issueLink`
    const linkResponse = await fetch(linkUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params!.accessToken}`,
      },
      body: JSON.stringify({
        type: resolvedType,
        inwardIssue: { key: params!.inwardIssueKey },
        outwardIssue: { key: params!.outwardIssueKey },
        comment: params?.comment
          ? {
              body: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: params!.comment,
                      },
                    ],
                  },
                ],
              },
            }
          : undefined,
      }),
    })
    if (!linkResponse.ok) {
      let message = `Failed to create issue link (${linkResponse.status})`
      try {
        const err = await linkResponse.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    // Try to extract the newly created link ID from the Location header
    const location = linkResponse.headers.get('location') || linkResponse.headers.get('Location')
    let linkId: string | undefined
    if (location) {
      const match = location.match(/\/issueLink\/(\d+)/)
      if (match) linkId = match[1]
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        inwardIssue: params?.inwardIssueKey || 'unknown',
        outwardIssue: params?.outwardIssueKey || 'unknown',
        linkType: params?.linkType || 'unknown',
        linkId,
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description:
        'Issue link details with timestamp, inward issue key, outward issue key, link type, and success status',
    },
  },
}
