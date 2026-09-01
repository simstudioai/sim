import type {
  MintlifyDeslopRewrite,
  MintlifyDeslopWindow,
  MintlifyDetectAiProseParams,
  MintlifyDetectAiProseResponse,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableNumber,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

function toRewrites(value: unknown): MintlifyDeslopRewrite[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const rewrite = (entry ?? {}) as Record<string, unknown>
    return {
      text: toNullableString(rewrite.text) ?? '',
      rationale: toNullableString(rewrite.rationale) ?? '',
    }
  })
}

function toWindows(value: unknown): MintlifyDeslopWindow[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const window = (entry ?? {}) as Record<string, unknown>
    const confidence = window.confidence
    return {
      text: toNullableString(window.text) ?? '',
      label: toNullableString(window.label) ?? '',
      aiAssistanceScore: toNullableNumber(window.aiAssistanceScore),
      confidence:
        typeof confidence === 'string' || typeof confidence === 'number' ? confidence : null,
      startLine: toNullableNumber(window.startLine),
      endLine: toNullableNumber(window.endLine),
      rewrites: toRewrites(window.rewrites),
    }
  })
}

export const mintlifyDetectAiProseTool: ToolConfig<
  MintlifyDetectAiProseParams,
  MintlifyDetectAiProseResponse
> = {
  id: 'mintlify_detect_ai_prose',
  name: 'Mintlify Detect AI-Sounding Prose',
  description:
    'Analyze a documentation page for AI-generated prose and return flagged passages with suggested human rewrites. Consumes one AI credit per checked page.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repo-relative path of the page, used for reporting only',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Raw MDX or Markdown content of the page to check (max 1,000,000 characters)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => `${MINTLIFY_API_BASE}/v1/deslop/${pathSegment(params.projectId)}`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
    body: (params) => ({ path: params.path, content: params.content }),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to analyze page for AI-sounding prose')

    return {
      success: true,
      output: {
        path: toNullableString(data.path),
        skipped: toNullableString(data.skipped),
        predictionShort: toNullableString(data.predictionShort),
        fractionAi: toNullableNumber(data.fractionAi),
        fractionAiAssisted: toNullableNumber(data.fractionAiAssisted),
        fractionHuman: toNullableNumber(data.fractionHuman),
        windows: toWindows(data.windows),
        creditsCharged: toNullableNumber(data.creditsCharged),
      },
    }
  },

  outputs: {
    path: { type: 'string', description: 'Path from the request', nullable: true },
    skipped: {
      type: 'string',
      description: 'Reason the page was skipped ("too_short"), or null when the page was checked',
      nullable: true,
    },
    predictionShort: {
      type: 'string',
      description:
        'Overall verdict for the page: AI, AI-Assisted, Human, or Mixed. Null when the page was skipped.',
      nullable: true,
      optional: true,
    },
    fractionAi: {
      type: 'number',
      description:
        'Fraction of the page detected as AI-generated (0-1). Null when the page was skipped.',
      nullable: true,
      optional: true,
    },
    fractionAiAssisted: {
      type: 'number',
      description:
        'Fraction of the page detected as AI-assisted (0-1). Null when the page was skipped.',
      nullable: true,
      optional: true,
    },
    fractionHuman: {
      type: 'number',
      description:
        'Fraction of the page detected as human-written (0-1). Null when the page was skipped.',
      nullable: true,
      optional: true,
    },
    windows: {
      type: 'array',
      description:
        'Flagged non-human passages with line ranges and suggested rewrites. Empty when the page was skipped.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The flagged passage text' },
          label: { type: 'string', description: 'Detection label, for example AI-Generated' },
          aiAssistanceScore: {
            type: 'number',
            description: 'AI-assistance score for the passage (0-1)',
            nullable: true,
          },
          confidence: {
            type: 'json',
            description: 'Detection confidence, either a label such as High or a numeric score',
            nullable: true,
          },
          startLine: {
            type: 'number',
            description: '1-based start line of the passage',
            nullable: true,
          },
          endLine: {
            type: 'number',
            description: '1-based end line of the passage',
            nullable: true,
          },
          rewrites: {
            type: 'array',
            description: 'Suggested human rewrites of the passage',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'The rewritten passage' },
                rationale: { type: 'string', description: 'Why the rewrite reads more human' },
              },
            },
          },
        },
      },
    },
    creditsCharged: {
      type: 'number',
      description: 'AI credits charged for this request (0 when skipped)',
      nullable: true,
    },
  },
}
