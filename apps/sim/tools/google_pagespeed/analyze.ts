import type {
  GooglePagespeedAnalyzeParams,
  GooglePagespeedAnalyzeResponse,
} from '@/tools/google_pagespeed/types'
import type { ToolConfig } from '@/tools/types'

export const analyzeTool: ToolConfig<GooglePagespeedAnalyzeParams, GooglePagespeedAnalyzeResponse> =
  {
    id: 'google_pagespeed_analyze',
    name: 'Google PageSpeed Analyze',
    description:
      'Analyze a webpage for performance, accessibility, SEO, and best practices using Google PageSpeed Insights.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Google PageSpeed Insights API Key',
      },
      url: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The URL of the webpage to analyze',
      },
      category: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Lighthouse categories to analyze (comma-separated): performance, accessibility, best-practices, seo',
      },
      strategy: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Analysis strategy: desktop or mobile',
      },
      locale: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Locale for results (e.g., en, fr, de)',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
        url.searchParams.append('url', params.url.trim())
        url.searchParams.append('key', params.apiKey)

        if (params.category) {
          const categories = params.category.split(',').map((c) => c.trim())
          for (const cat of categories) {
            url.searchParams.append('category', cat)
          }
        } else {
          url.searchParams.append('category', 'performance')
          url.searchParams.append('category', 'accessibility')
          url.searchParams.append('category', 'best-practices')
          url.searchParams.append('category', 'seo')
        }

        if (params.strategy) {
          url.searchParams.append('strategy', params.strategy)
        }
        if (params.locale) {
          url.searchParams.append('locale', params.locale)
        }

        return url.toString()
      },
      method: 'GET',
      headers: () => ({
        Accept: 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message ?? 'Failed to analyze page')
      }

      const lighthouse = data.lighthouseResult ?? {}
      const categories = lighthouse.categories ?? {}
      const audits = lighthouse.audits ?? {}
      const loadingExperience = data.loadingExperience ?? {}

      return {
        success: true,
        output: {
          finalUrl: data.id ?? null,
          performanceScore: categories.performance?.score ?? null,
          accessibilityScore: categories.accessibility?.score ?? null,
          bestPracticesScore: categories['best-practices']?.score ?? null,
          seoScore: categories.seo?.score ?? null,
          firstContentfulPaint: audits['first-contentful-paint']?.displayValue ?? null,
          firstContentfulPaintMs: audits['first-contentful-paint']?.numericValue ?? null,
          largestContentfulPaint: audits['largest-contentful-paint']?.displayValue ?? null,
          largestContentfulPaintMs: audits['largest-contentful-paint']?.numericValue ?? null,
          totalBlockingTime: audits['total-blocking-time']?.displayValue ?? null,
          totalBlockingTimeMs: audits['total-blocking-time']?.numericValue ?? null,
          cumulativeLayoutShift: audits['cumulative-layout-shift']?.displayValue ?? null,
          cumulativeLayoutShiftValue: audits['cumulative-layout-shift']?.numericValue ?? null,
          speedIndex: audits['speed-index']?.displayValue ?? null,
          speedIndexMs: audits['speed-index']?.numericValue ?? null,
          interactive: audits.interactive?.displayValue ?? null,
          interactiveMs: audits.interactive?.numericValue ?? null,
          overallCategory: loadingExperience.overall_category ?? null,
          analysisTimestamp: data.analysisUTCTimestamp ?? null,
          lighthouseVersion: lighthouse.lighthouseVersion ?? null,
        },
      }
    },

    outputs: {
      finalUrl: {
        type: 'string',
        description: 'The final URL after redirects',
        optional: true,
      },
      performanceScore: {
        type: 'number',
        description: 'Performance category score (0-1)',
        optional: true,
      },
      accessibilityScore: {
        type: 'number',
        description: 'Accessibility category score (0-1)',
        optional: true,
      },
      bestPracticesScore: {
        type: 'number',
        description: 'Best Practices category score (0-1)',
        optional: true,
      },
      seoScore: {
        type: 'number',
        description: 'SEO category score (0-1)',
        optional: true,
      },
      firstContentfulPaint: {
        type: 'string',
        description: 'Time to First Contentful Paint (display value)',
        optional: true,
      },
      firstContentfulPaintMs: {
        type: 'number',
        description: 'Time to First Contentful Paint in milliseconds',
        optional: true,
      },
      largestContentfulPaint: {
        type: 'string',
        description: 'Time to Largest Contentful Paint (display value)',
        optional: true,
      },
      largestContentfulPaintMs: {
        type: 'number',
        description: 'Time to Largest Contentful Paint in milliseconds',
        optional: true,
      },
      totalBlockingTime: {
        type: 'string',
        description: 'Total Blocking Time (display value)',
        optional: true,
      },
      totalBlockingTimeMs: {
        type: 'number',
        description: 'Total Blocking Time in milliseconds',
        optional: true,
      },
      cumulativeLayoutShift: {
        type: 'string',
        description: 'Cumulative Layout Shift (display value)',
        optional: true,
      },
      cumulativeLayoutShiftValue: {
        type: 'number',
        description: 'Cumulative Layout Shift numeric value',
        optional: true,
      },
      speedIndex: {
        type: 'string',
        description: 'Speed Index (display value)',
        optional: true,
      },
      speedIndexMs: {
        type: 'number',
        description: 'Speed Index in milliseconds',
        optional: true,
      },
      interactive: {
        type: 'string',
        description: 'Time to Interactive (display value)',
        optional: true,
      },
      interactiveMs: {
        type: 'number',
        description: 'Time to Interactive in milliseconds',
        optional: true,
      },
      overallCategory: {
        type: 'string',
        description: 'Overall loading experience category (FAST, AVERAGE, SLOW, or NONE)',
        optional: true,
      },
      analysisTimestamp: {
        type: 'string',
        description: 'UTC timestamp of the analysis',
        optional: true,
      },
      lighthouseVersion: {
        type: 'string',
        description: 'Version of Lighthouse used for the analysis',
        optional: true,
      },
    },
  }
