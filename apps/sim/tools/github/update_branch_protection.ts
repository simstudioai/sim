import type { BranchProtectionResponse, UpdateBranchProtectionParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const updateBranchProtectionTool: ToolConfig<
  UpdateBranchProtectionParams,
  BranchProtectionResponse
> = {
  id: 'github_update_branch_protection',
  name: 'GitHub Update Branch Protection',
  description:
    'Update branch protection rules for a specific branch, including status checks, review requirements, admin enforcement, and push restrictions.',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner (user or organization)',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Branch name',
    },
    required_status_checks: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Required status check configuration (null to disable). Object with strict (boolean) and contexts (string array)',
    },
    enforce_admins: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to enforce restrictions for administrators',
    },
    required_pull_request_reviews: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'PR review requirements (null to disable). Object with optional required_approving_review_count, dismiss_stale_reviews, require_code_owner_reviews',
    },
    restrictions: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Push restrictions (null to disable). Object with users (string array) and teams (string array)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/branches/${params.branch}/protection`,
    method: 'PUT',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {
        required_status_checks: params.required_status_checks,
        enforce_admins: params.enforce_admins,
        required_pull_request_reviews: params.required_pull_request_reviews,
        restrictions: params.restrictions,
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const protection = await response.json()

    let content = `Branch Protection updated successfully for "${protection.url.split('/branches/')[1].split('/protection')[0]}":

Enforce Admins: ${protection.enforce_admins?.enabled ? 'Yes' : 'No'}`

    if (protection.required_status_checks) {
      content += `\n\nRequired Status Checks:
- Strict: ${protection.required_status_checks.strict}
- Contexts: ${protection.required_status_checks.contexts.length > 0 ? protection.required_status_checks.contexts.join(', ') : 'None'}`
    } else {
      content += '\n\nRequired Status Checks: Disabled'
    }

    if (protection.required_pull_request_reviews) {
      content += `\n\nRequired Pull Request Reviews:
- Required Approving Reviews: ${protection.required_pull_request_reviews.required_approving_review_count || 0}
- Dismiss Stale Reviews: ${protection.required_pull_request_reviews.dismiss_stale_reviews ? 'Yes' : 'No'}
- Require Code Owner Reviews: ${protection.required_pull_request_reviews.require_code_owner_reviews ? 'Yes' : 'No'}`
    } else {
      content += '\n\nRequired Pull Request Reviews: Disabled'
    }

    if (protection.restrictions) {
      const users = protection.restrictions.users?.map((u: any) => u.login) || []
      const teams = protection.restrictions.teams?.map((t: any) => t.slug) || []
      content += `\n\nRestrictions:
- Users: ${users.length > 0 ? users.join(', ') : 'None'}
- Teams: ${teams.length > 0 ? teams.join(', ') : 'None'}`
    } else {
      content += '\n\nRestrictions: Disabled'
    }

    return {
      success: true,
      output: {
        content,
        metadata: {
          required_status_checks: protection.required_status_checks
            ? {
                strict: protection.required_status_checks.strict,
                contexts: protection.required_status_checks.contexts,
              }
            : null,
          enforce_admins: {
            enabled: protection.enforce_admins?.enabled || false,
          },
          required_pull_request_reviews: protection.required_pull_request_reviews
            ? {
                required_approving_review_count:
                  protection.required_pull_request_reviews.required_approving_review_count || 0,
                dismiss_stale_reviews:
                  protection.required_pull_request_reviews.dismiss_stale_reviews || false,
                require_code_owner_reviews:
                  protection.required_pull_request_reviews.require_code_owner_reviews || false,
              }
            : null,
          restrictions: protection.restrictions
            ? {
                users: protection.restrictions.users?.map((u: any) => u.login) || [],
                teams: protection.restrictions.teams?.map((t: any) => t.slug) || [],
              }
            : null,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable branch protection update summary' },
    metadata: {
      type: 'object',
      description: 'Updated branch protection configuration',
      properties: {
        required_status_checks: {
          type: 'object',
          description: 'Status check requirements (null if disabled)',
          properties: {
            strict: { type: 'boolean', description: 'Require branches to be up to date' },
            contexts: {
              type: 'array',
              description: 'Required status check contexts',
              items: { type: 'string' },
            },
          },
        },
        enforce_admins: {
          type: 'object',
          description: 'Admin enforcement settings',
          properties: {
            enabled: { type: 'boolean', description: 'Enforce for administrators' },
          },
        },
        required_pull_request_reviews: {
          type: 'object',
          description: 'Pull request review requirements (null if disabled)',
          properties: {
            required_approving_review_count: {
              type: 'number',
              description: 'Number of approving reviews required',
            },
            dismiss_stale_reviews: {
              type: 'boolean',
              description: 'Dismiss stale pull request approvals',
            },
            require_code_owner_reviews: {
              type: 'boolean',
              description: 'Require review from code owners',
            },
          },
        },
        restrictions: {
          type: 'object',
          description: 'Push restrictions (null if disabled)',
          properties: {
            users: {
              type: 'array',
              description: 'Users who can push',
              items: { type: 'string' },
            },
            teams: {
              type: 'array',
              description: 'Teams who can push',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
}
