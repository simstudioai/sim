import type { BranchProtectionResponse, UpdateBranchProtectionParams } from '@/tools/github/types'
import { BRANCH_PROTECTION_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Names the failure class without echoing the rejected text. `JSON.parse` quotes
 * the input it rejected back into its own message, and these fields can carry
 * values resolved from other blocks.
 */
const BRANCH_PROTECTION_SHAPE_ERROR =
  'Branch protection fields must be a JSON object, or left empty to disable the rule'

/**
 * GitHub documents `required_status_checks`, `enforce_admins`,
 * `required_pull_request_reviews` and `restrictions` as required body fields
 * that are nullable — each says "Set to null to disable". "Required" there means
 * *present in the body*, and `null` satisfies it. Sim's `required: true` means
 * the user must supply a non-empty value, which is strictly stronger and made
 * the tool unusable. The params below are therefore optional and this builder
 * supplies the explicit `null` GitHub demands for every field left unset.
 */
function toNullableObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '' || trimmed === 'null') return null
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(BRANCH_PROTECTION_SHAPE_ERROR)
    }
    if (parsed === null) return null
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(BRANCH_PROTECTION_SHAPE_ERROR)
    }
    return parsed as Record<string, unknown>
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(BRANCH_PROTECTION_SHAPE_ERROR)
  }
  return value as Record<string, unknown>
}

/** Normalizes a nullable boolean body field, tolerating the block's dropdown strings. */
function toNullableBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  return Boolean(value)
}

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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Required status check configuration. Object with strict (boolean) and contexts (string array). Omit to disable status checks — GitHub receives an explicit null.',
    },
    enforce_admins: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to enforce restrictions for administrators. Omit to disable admin enforcement — GitHub receives an explicit null.',
    },
    required_pull_request_reviews: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'PR review requirements. Object with optional required_approving_review_count, dismiss_stale_reviews, require_code_owner_reviews. Omit to disable review requirements — GitHub receives an explicit null.',
    },
    restrictions: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Push restrictions, available only for organization-owned repositories. Object with users (string array), teams (string array) and optional apps (string array). Omit to disable push restrictions — GitHub receives an explicit null.',
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
    body: (params) => ({
      required_status_checks: toNullableObject(params.required_status_checks),
      enforce_admins: toNullableBoolean(params.enforce_admins),
      required_pull_request_reviews: toNullableObject(params.required_pull_request_reviews),
      restrictions: toNullableObject(params.restrictions),
    }),
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

export const updateBranchProtectionV2Tool: ToolConfig = {
  id: 'github_update_branch_protection_v2',
  name: updateBranchProtectionTool.name,
  description: updateBranchProtectionTool.description,
  version: '2.0.0',
  params: updateBranchProtectionTool.params,
  request: updateBranchProtectionTool.request,
  oauth: updateBranchProtectionTool.oauth,
  transformResponse: async (response: Response) => {
    const protection = await response.json()
    return {
      success: true,
      output: {
        url: protection.url,
        required_status_checks: protection.required_status_checks ?? null,
        enforce_admins: protection.enforce_admins,
        required_pull_request_reviews: protection.required_pull_request_reviews ?? null,
        restrictions: protection.restrictions ?? null,
        required_linear_history: protection.required_linear_history ?? null,
        allow_force_pushes: protection.allow_force_pushes ?? null,
        allow_deletions: protection.allow_deletions ?? null,
      },
    }
  },
  outputs: BRANCH_PROTECTION_OUTPUT_PROPERTIES,
}
