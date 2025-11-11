import type {
  GoogleFormsGetResponsesParams,
  GoogleFormsResponse,
  GoogleFormsResponseList,
} from '@/tools/google_form/types'
import { buildGetResponseUrl, buildListResponsesUrl } from '@/tools/google_form/utils'
import type { ToolConfig } from '@/tools/types'

export const getResponsesTool: ToolConfig<GoogleFormsGetResponsesParams> = {
  id: 'google_forms_get_responses',
  name: 'Google Forms: Get Responses',
  description: 'Retrieve a single response or list responses from a Google Form',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-forms',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth2 access token',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the Google Form',
    },
    responseId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'If provided, returns this specific response',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description:
        'Maximum number of responses to return (service may return fewer). Defaults to 5000.',
    },
  },

  request: {
    url: (params: GoogleFormsGetResponsesParams) =>
      params.responseId
        ? buildGetResponseUrl({ formId: params.formId, responseId: params.responseId })
        : buildListResponsesUrl({
            formId: params.formId,
            pageSize: params.pageSize ? Number(params.pageSize) : undefined,
          }),
    method: 'GET',
    headers: (params: GoogleFormsGetResponsesParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: GoogleFormsGetResponsesParams) => {
    const data = (await response.json()) as unknown

    if (!response.ok) {
      let errorMessage = response.statusText || 'Failed to fetch responses'
      if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>
        const error = record.error as { message?: string } | undefined
        if (error?.message) {
          errorMessage = error.message
        }
      }

      return {
        success: false,
        output: (data as Record<string, unknown>) || {},
        error: errorMessage,
      }
    }

    // Normalize answers into a flat key/value map per response
    const normalizeAnswerContainer = (container: unknown): unknown => {
      if (!container || typeof container !== 'object') return container
      const record = container as Record<string, unknown>
      const answers = record.answers as unknown[] | undefined
      if (Array.isArray(answers)) {
        const values = answers.map((entry) => {
          if (entry && typeof entry === 'object') {
            const er = entry as Record<string, unknown>
            if (typeof er.value !== 'undefined') return er.value
          }
          return entry
        })
        return values.length === 1 ? values[0] : values
      }
      return container
    }

    const normalizeAnswers = (answers: unknown): Record<string, unknown> => {
      if (!answers || typeof answers !== 'object') return {}
      const src = answers as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [questionId, answerObj] of Object.entries(src)) {
        if (answerObj && typeof answerObj === 'object') {
          const aRec = answerObj as Record<string, unknown>
          // Find first *Answers property that contains an answers array
          const key = Object.keys(aRec).find(
            (k) => k.toLowerCase().endsWith('answers') && Array.isArray((aRec[k] as any)?.answers)
          )
          if (key) {
            out[questionId] = normalizeAnswerContainer(aRec[key])
            continue
          }
        }
        out[questionId] = answerObj as unknown
      }
      return out
    }

    const normalizeResponse = (r: GoogleFormsResponse): Record<string, unknown> => ({
      responseId: r.responseId,
      createTime: r.createTime,
      lastSubmittedTime: r.lastSubmittedTime,
      answers: normalizeAnswers(r.answers as unknown),
    })

    // Distinguish single vs list response shapes
    const isList = (obj: unknown): obj is GoogleFormsResponseList =>
      !!obj && typeof obj === 'object' && Array.isArray((obj as GoogleFormsResponseList).responses)

    if (isList(data)) {
      const listData = data as GoogleFormsResponseList
      const toTimestamp = (s?: string): number => {
        if (!s) return 0
        const t = Date.parse(s)
        return Number.isNaN(t) ? 0 : t
      }
      const sorted = (listData.responses || [])
        .slice()
        .sort(
          (a, b) =>
            toTimestamp(b.lastSubmittedTime || b.createTime) -
            toTimestamp(a.lastSubmittedTime || a.createTime)
        )
      const normalized = sorted.map((r) => normalizeResponse(r))
      return {
        success: true,
        output: {
          responses: normalized,
          raw: listData,
        } as unknown as Record<string, unknown>,
      }
    }

    const single = data as GoogleFormsResponse
    const normalizedSingle = normalizeResponse(single)

    return {
      success: true,
      output: {
        response: normalizedSingle,
        raw: single,
      } as unknown as Record<string, unknown>,
    }
  },
}
