import { generateId } from '@sim/utils/id'
import { filterUndefined } from '@sim/utils/object'
import type {
  LangsmithCreateFeedbackParams,
  LangsmithCreateFeedbackResponse,
} from '@/tools/langsmith/types'
import type { ToolConfig } from '@/tools/types'

export const langsmithCreateFeedbackTool: ToolConfig<
  LangsmithCreateFeedbackParams,
  LangsmithCreateFeedbackResponse
> = {
  id: 'langsmith_create_feedback',
  name: 'LangSmith Create Feedback',
  description: 'Attach a score, correction, or comment to a LangSmith run.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LangSmith API key',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to attach feedback to',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Feedback metric name (e.g. "correctness", "user_score")',
    },
    score: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Numeric or boolean score for the feedback metric',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Categorical value for the feedback metric',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text comment explaining the feedback',
    },
    correction: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Corrected output for the run',
    },
    feedbackSourceType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Origin of the feedback (api, app, or model)',
    },
  },
  request: {
    url: () => 'https://api.smith.langchain.com/feedback',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const payload: Record<string, unknown> = {
        id: generateId(),
        run_id: params.runId.trim(),
        key: params.key,
        score: params.score,
        value: params.value,
        comment: params.comment,
        correction: params.correction,
        feedback_source: params.feedbackSourceType
          ? { type: params.feedbackSourceType }
          : undefined,
      }

      return filterUndefined(payload)
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LangSmith create feedback failed (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as Record<string, unknown>

    return {
      success: true,
      output: {
        id: data.id as string,
        key: data.key as string,
        runId: (data.run_id as string) ?? null,
        score: (data.score as number | boolean) ?? null,
        value: (data.value as string | number | boolean) ?? null,
        comment: (data.comment as string) ?? null,
        createdAt: (data.created_at as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Feedback ID' },
    key: { type: 'string', description: 'Feedback metric name' },
    runId: {
      type: 'string',
      description: 'ID of the run the feedback was attached to',
      optional: true,
    },
    score: { type: 'number', description: 'Score recorded for the feedback', optional: true },
    value: {
      type: 'string',
      description: 'Categorical value recorded for the feedback',
      optional: true,
    },
    comment: { type: 'string', description: 'Comment recorded for the feedback', optional: true },
    createdAt: {
      type: 'string',
      description: 'When the feedback was created (ISO)',
      optional: true,
    },
  },
}
