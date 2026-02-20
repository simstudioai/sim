import type { JiraDeleteVersionParams, JiraDeleteVersionResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraDeleteVersionTool: ToolConfig<JiraDeleteVersionParams, JiraDeleteVersionResponse> =
  {
    id: 'jira_delete_version',
    name: 'Jira Delete Version',
    description: 'Delete a version/release from a Jira project',
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
      versionId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Version ID to delete',
      },
      moveFixIssuesTo: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Version ID to move fix version issues to (optional)',
      },
      moveAffectedIssuesTo: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Version ID to move affected version issues to (optional)',
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
      url: (params: JiraDeleteVersionParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/version/${params.versionId.trim()}/removeAndSwap`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraDeleteVersionParams) => (params.cloudId ? 'POST' : 'GET'),
      headers: (params: JiraDeleteVersionParams) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }),
      body: (params: JiraDeleteVersionParams) => {
        if (!params.cloudId) return undefined as any
        const body: Record<string, unknown> = {}
        if (params.moveFixIssuesTo) body.moveFixIssuesTo = Number(params.moveFixIssuesTo.trim())
        if (params.moveAffectedIssuesTo)
          body.moveAffectedIssuesTo = Number(params.moveAffectedIssuesTo.trim())
        return body
      },
    },

    transformResponse: async (response: Response, params?: JiraDeleteVersionParams) => {
      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        const body: Record<string, unknown> = {}
        if (params?.moveFixIssuesTo) body.moveFixIssuesTo = Number(params.moveFixIssuesTo.trim())
        if (params?.moveAffectedIssuesTo)
          body.moveAffectedIssuesTo = Number(params.moveAffectedIssuesTo.trim())

        const deleteResponse = await fetch(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/version/${params!.versionId.trim()}/removeAndSwap`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${params!.accessToken}`,
            },
            body: JSON.stringify(body),
          }
        )

        if (deleteResponse.status !== 204 && !deleteResponse.ok) {
          let message = `Failed to delete version (${deleteResponse.status})`
          try {
            const err = await deleteResponse.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }

        return {
          success: true,
          output: {
            ts: new Date().toISOString(),
            versionId: params!.versionId,
            success: true,
          },
        }
      }

      if (response.status !== 204 && !response.ok) {
        let message = `Failed to delete version (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          versionId: params?.versionId ?? 'unknown',
          success: true,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      success: SUCCESS_OUTPUT,
      versionId: { type: 'string', description: 'Deleted version ID' },
    },
  }
