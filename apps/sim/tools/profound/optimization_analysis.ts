import type { ToolConfig } from '@/tools/types'
import type {
  ProfoundOptimizationAnalysisParams,
  ProfoundOptimizationAnalysisResponse,
} from './types'

export const profoundOptimizationAnalysisTool: ToolConfig<
  ProfoundOptimizationAnalysisParams,
  ProfoundOptimizationAnalysisResponse
> = {
  id: 'profound_optimization_analysis',
  name: 'Profound Optimization Analysis',
  description: 'Get detailed content optimization analysis for a specific content item in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    assetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asset ID (UUID)',
    },
    contentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content/optimization ID (UUID)',
    },
  },

  request: {
    url: (params) =>
      `https://api.tryprofound.com/v1/content/${encodeURIComponent(params.assetId)}/optimization/${encodeURIComponent(params.contentId)}`,
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to get optimization analysis')
    }
    const analysis = data.data
    return {
      success: true,
      output: {
        content: {
          format: analysis?.content?.format ?? null,
          value: analysis?.content?.value ?? null,
        },
        aeoContentScore: analysis?.aeo_content_score
          ? {
              value: analysis.aeo_content_score.value ?? 0,
              targetZone: {
                low: analysis.aeo_content_score.target_zone?.low ?? 0,
                high: analysis.aeo_content_score.target_zone?.high ?? 0,
              },
            }
          : null,
        analysis: {
          breakdown: (analysis?.analysis?.breakdown ?? []).map(
            (b: { title: string; weight: number; score: number }) => ({
              title: b.title ?? null,
              weight: b.weight ?? 0,
              score: b.score ?? 0,
            })
          ),
        },
        recommendations: (analysis?.recommendations ?? []).map(
          (r: {
            title: string
            status: string
            impact: { section: string; score: number } | null
            suggestion: { text: string; rationale: string }
          }) => ({
            title: r.title ?? null,
            status: r.status ?? null,
            impact: r.impact
              ? {
                  section: r.impact.section ?? null,
                  score: r.impact.score ?? 0,
                }
              : null,
            suggestion: {
              text: r.suggestion?.text ?? null,
              rationale: r.suggestion?.rationale ?? null,
            },
          })
        ),
      },
    }
  },

  outputs: {
    content: {
      type: 'json',
      description: 'The analyzed content',
      properties: {
        format: { type: 'string', description: 'Content format: markdown or html' },
        value: { type: 'string', description: 'Content text' },
      },
    },
    aeoContentScore: {
      type: 'json',
      description: 'AEO content score with target zone',
      optional: true,
      properties: {
        value: { type: 'number', description: 'AEO score value' },
        targetZone: {
          type: 'json',
          description: 'Target zone range',
          properties: {
            low: { type: 'number', description: 'Low end of target range' },
            high: { type: 'number', description: 'High end of target range' },
          },
        },
      },
    },
    analysis: {
      type: 'json',
      description: 'Analysis breakdown by category',
      properties: {
        breakdown: {
          type: 'json',
          description: 'Array of scoring breakdowns',
          properties: {
            title: { type: 'string', description: 'Category title' },
            weight: { type: 'number', description: 'Category weight' },
            score: { type: 'number', description: 'Category score' },
          },
        },
      },
    },
    recommendations: {
      type: 'json',
      description: 'Content optimization recommendations',
      properties: {
        title: { type: 'string', description: 'Recommendation title' },
        status: { type: 'string', description: 'Status: done or pending' },
        impact: { type: 'json', description: 'Impact details with section and score' },
        suggestion: {
          type: 'json',
          description: 'Suggestion text and rationale',
          properties: {
            text: { type: 'string', description: 'Suggestion text' },
            rationale: { type: 'string', description: 'Why this recommendation matters' },
          },
        },
      },
    },
  },
}
