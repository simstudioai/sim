import { normalizeSubreddit } from '@/tools/reddit/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface RedditSubredditRule {
  short_name: string
  description: string
  description_html: string
  violation_reason: string
  kind: string
  created_utc: number
  priority: number
}

interface RedditGetSubredditRulesParams {
  subreddit: string
  accessToken?: string
}

interface RedditGetSubredditRulesResponse extends ToolResponse {
  output: {
    rules: RedditSubredditRule[]
    site_rules: string[]
    site_rules_flow: unknown[]
  }
}

export const getSubredditRulesTool: ToolConfig<
  RedditGetSubredditRulesParams,
  RedditGetSubredditRulesResponse
> = {
  id: 'reddit_get_subreddit_rules',
  name: 'Get Subreddit Rules',
  description: 'Get the rules and site-wide rules that apply to a subreddit',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'reddit',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Reddit API',
    },
    subreddit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The subreddit to get rules for (e.g., "technology", "programming", "news")',
    },
  },

  request: {
    url: (params: RedditGetSubredditRulesParams) => {
      const subreddit = normalizeSubreddit(params.subreddit)
      return `https://oauth.reddit.com/r/${subreddit}/about/rules?raw_json=1`
    },
    method: 'GET',
    headers: (params: RedditGetSubredditRulesParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          rules: [],
          site_rules: [],
          site_rules_flow: [],
        },
      }
    }

    const rules: RedditSubredditRule[] =
      data.rules?.map((rule: any) => ({
        short_name: rule.short_name ?? '',
        description: rule.description ?? '',
        description_html: rule.description_html ?? '',
        violation_reason: rule.violation_reason ?? '',
        kind: rule.kind ?? '',
        created_utc: rule.created_utc ?? 0,
        priority: rule.priority ?? 0,
      })) || []

    return {
      success: true,
      output: {
        rules,
        site_rules: data.site_rules ?? [],
        site_rules_flow: data.site_rules_flow ?? [],
      },
    }
  },

  outputs: {
    rules: {
      type: 'array',
      description: 'Array of subreddit-specific rules',
      items: {
        type: 'object',
        properties: {
          short_name: { type: 'string', description: 'Short name/title of the rule' },
          description: { type: 'string', description: 'Full description of the rule (markdown)' },
          description_html: {
            type: 'string',
            description: 'HTML-rendered rule description',
            optional: true,
          },
          violation_reason: {
            type: 'string',
            description: 'Reason shown on the report menu when this rule is selected',
          },
          kind: {
            type: 'string',
            description: 'What the rule applies to: "link", "comment", or "all"',
          },
          created_utc: { type: 'number', description: 'Creation time in UTC epoch seconds' },
          priority: { type: 'number', description: 'Display/order priority of the rule' },
        },
      },
    },
    site_rules: {
      type: 'array',
      description: 'Reddit site-wide rules that apply to the subreddit',
      items: { type: 'string', description: 'Site-wide rule text' },
    },
    site_rules_flow: {
      type: 'array',
      description: 'Structured site-wide rules flow used by the report menu',
      items: { type: 'object', description: 'Site-wide rule flow node' },
    },
  },
}
