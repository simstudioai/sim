import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  CaptureKitAnalyzeWebsiteParams,
  CaptureKitAnalyzeWebsiteResponse,
} from '@/tools/capturekit/types'
import type { ToolConfig } from '@/tools/types'

export const capturekitAnalyzeWebsiteTool: ToolConfig<
  CaptureKitAnalyzeWebsiteParams,
  CaptureKitAnalyzeWebsiteResponse
> = {
  id: 'capturekit_analyze_website',
  name: 'CaptureKit Analyze Website',
  description:
    'Read a website and get an AI summary of its value proposition, business type, key features, categories, use cases, audience and contact details.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the page (e.g., "https://example.com")',
    },
    customPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Extra instructions for the analysis (e.g., "Focus on pricing")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CaptureKit API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.capturekit.dev/v1/analyze`)
      url.searchParams.set('url', params.url.trim())
      if (params.customPrompt?.trim())
        url.searchParams.set('custom_prompt', params.customPrompt.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        summary: toStringOrNull(toRecord(data.data).summary),
        valueProposition: toStringOrNull(toRecord(data.data).valueProposition),
        businessType: toStringOrNull(toRecord(data.data).businessType),
        targetAudience: toStringOrNull(toRecord(data.data).targetAudience),
        callToAction: toStringOrNull(toRecord(data.data).callToAction),
        keyFeatures: toArray(toRecord(data.data).keyFeatures).filter(
          (item): item is string => typeof item === 'string'
        ),
        categories: toArray(toRecord(data.data).categories).filter(
          (item): item is string => typeof item === 'string'
        ),
        useCases: toArray(toRecord(data.data).useCases).filter(
          (item): item is string => typeof item === 'string'
        ),
        emails: toArray(toRecord(data.data).emails).filter(
          (item): item is string => typeof item === 'string'
        ),
        phoneNumbers: toArray(toRecord(data.data).phoneNumbers).filter(
          (item): item is string => typeof item === 'string'
        ),
      },
    }
  },

  outputs: {
    summary: {
      type: 'string',
      description: 'Summary of what the website offers',
      optional: true,
    },
    valueProposition: {
      type: 'string',
      description: 'Value proposition of the website',
      optional: true,
    },
    businessType: {
      type: 'string',
      description: 'Type of business',
      optional: true,
    },
    targetAudience: {
      type: 'string',
      description: 'Audience the website addresses',
      optional: true,
    },
    callToAction: {
      type: 'string',
      description: 'Main call to action of the website',
      optional: true,
    },
    keyFeatures: {
      type: 'array',
      description: 'Key features of the product or service',
      optional: true,
      items: { type: 'string' },
    },
    categories: {
      type: 'array',
      description: 'Categories of the website',
      optional: true,
      items: { type: 'string' },
    },
    useCases: {
      type: 'array',
      description: 'Use cases the website describes',
      optional: true,
      items: { type: 'string' },
    },
    emails: {
      type: 'array',
      description: 'Email addresses found on the website',
      optional: true,
      items: { type: 'string' },
    },
    phoneNumbers: {
      type: 'array',
      description: 'Phone numbers found on the website',
      optional: true,
      items: { type: 'string' },
    },
  },
}
