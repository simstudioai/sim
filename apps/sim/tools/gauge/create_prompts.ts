import { isRecordLike } from '@sim/utils/object'
import { CREATE_RESULT_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeCreatePromptsOut,
  GaugeCreatePromptsParams,
  GaugeCreatePromptsResponse,
  GaugePromptIn,
} from '@/tools/gauge/types'
import {
  buildGaugeUrl,
  gaugeAuthParams,
  gaugeHeaders,
  gaugeOAuth,
  parseGaugeJson,
  parseGaugeStringArray,
} from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const MAX_PROMPT_TEXT_LENGTH = 500

/** Matches Gauge's code-point limit without expanding oversized strings. */
function isPromptTextWithinLimit(text: string): boolean {
  return (
    text.length <= MAX_PROMPT_TEXT_LENGTH ||
    (text.length <= MAX_PROMPT_TEXT_LENGTH * 2 && Array.from(text).length <= MAX_PROMPT_TEXT_LENGTH)
  )
}

/** Validates the batch before selecting only the text Gauge sends to AI engines. */
function parseGaugePrompts(value: unknown): GaugePromptIn[] {
  const parsed = parseGaugeJson(value, 'prompts')
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 500) {
    throw new Error('prompts must be a JSON array containing 1 to 500 prompts')
  }
  return parsed.map((prompt) => {
    if (
      !isRecordLike(prompt) ||
      typeof prompt.text !== 'string' ||
      !prompt.text.trim() ||
      !isPromptTextWithinLimit(prompt.text) ||
      typeof prompt.topicId !== 'string' ||
      !prompt.topicId.trim()
    ) {
      throw new Error('Each prompt must have text (1 to 500 characters) and a topicId')
    }
    if (
      prompt.trackingType !== undefined &&
      prompt.trackingType !== 'visibility' &&
      prompt.trackingType !== 'branded_own'
    ) {
      throw new Error('Prompt trackingType must be visibility or branded_own')
    }
    return {
      text: prompt.text,
      topicId: prompt.topicId,
      ...(prompt.trackingType !== undefined ? { trackingType: prompt.trackingType } : {}),
      ...(prompt.tagIds !== undefined
        ? { tagIds: parseGaugeStringArray(prompt.tagIds, 'prompt tagIds') }
        : {}),
    }
  })
}

/** Selects model-visible prompt text without projecting topic IDs, tags, or control fields. */
function selectGaugePromptText(params: { prompts: unknown }): Record<string, unknown> {
  return { prompts: parseGaugePrompts(params.prompts).map((prompt) => prompt.text) }
}

/** Rebuilds the original JSON representation after the shared executor projects prompt text. */
function rebuildGaugePrompts(original: unknown, projectedText: unknown): string | GaugePromptIn[] {
  const prompts = parseGaugePrompts(original)
  if (!Array.isArray(projectedText) || projectedText.length !== prompts.length) {
    throw new Error('Projected Gauge prompts must match the original prompt batch')
  }
  const texts = projectedText.map((text: unknown) => {
    if (typeof text !== 'string') {
      throw new Error('Projected Gauge prompts must match the original prompt batch')
    }
    return text
  })
  const rebuilt = prompts.map((prompt, index) => ({ ...prompt, text: texts[index] ?? '' }))
  return typeof original === 'string' ? JSON.stringify(rebuilt) : rebuilt
}

export const gaugeCreatePromptsTool: ToolConfig<
  GaugeCreatePromptsParams,
  GaugeCreatePromptsResponse
> = {
  id: 'gauge_create_prompts',
  name: 'Gauge Create Prompts',
  description: 'Add a batch of tracked questions or preview the import without creating prompts.',
  version: '1.0.0',
  oauth: gaugeOAuth,
  params: {
    ...gaugeAuthParams,
    org: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization slug or UUID',
    },
    category: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category slug or cat_ ID',
    },
    dryRun: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Validate the batch and report what would be created without saving prompts',
    },
    prompts: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of 1–500 prompts: [{"text":"Which tools work best?","topicId":"top_example","trackingType":"visibility","tagIds":[]}]',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/prompts`,
        { dryRun: params.dryRun }
      ),
    method: 'POST',
    headers: (params) => gaugeHeaders(params.accessToken, true),
    modelInput: {
      mode: 'project',
      select: selectGaugePromptText,
      applyProjected: (selectedParams, projectedSelection) => ({
        prompts: rebuildGaugePrompts(selectedParams.prompts, projectedSelection.prompts),
      }),
    },
    body: (params) => ({ prompts: parseGaugePrompts(params.prompts) }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeCreatePromptsOut
    return {
      success: true,
      output: {
        results: (data.results ?? []).map((item) => ({
          index: item.index,
          status: item.status,
          prompt:
            item.prompt == null
              ? null
              : {
                  id: item.prompt.id,
                  text: item.prompt.text,
                  topicId: item.prompt.topicId ?? null,
                  trackingType: item.prompt.trackingType,
                  tagIds: item.prompt.tagIds ?? [],
                  createdAt: item.prompt.createdAt,
                  firstAnswerDay: item.prompt.firstAnswerDay ?? null,
                },
        })),
        dryRun: data.dryRun,
        remaining: data.remaining ?? null,
      },
    }
  },
  outputs: {
    results: {
      type: 'array',
      items: { type: 'object', properties: CREATE_RESULT_PROPERTIES },
      description: 'Results',
    },
    dryRun: { type: 'boolean', description: 'Dry run' },
    remaining: { type: 'number', description: 'Remaining', nullable: true },
  },
}
