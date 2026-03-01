import type { ToolResponse } from '@/tools/types'

export interface GooglePagespeedBaseParams {
  apiKey: string
}

export interface GooglePagespeedAnalyzeParams extends GooglePagespeedBaseParams {
  url: string
  category?: string
  strategy?: string
  locale?: string
}

export interface GooglePagespeedAnalyzeResponse extends ToolResponse {
  output: {
    finalUrl: string | null
    performanceScore: number | null
    accessibilityScore: number | null
    bestPracticesScore: number | null
    seoScore: number | null
    firstContentfulPaint: string | null
    firstContentfulPaintMs: number | null
    largestContentfulPaint: string | null
    largestContentfulPaintMs: number | null
    totalBlockingTime: string | null
    totalBlockingTimeMs: number | null
    cumulativeLayoutShift: string | null
    cumulativeLayoutShiftValue: number | null
    speedIndex: string | null
    speedIndexMs: number | null
    interactive: string | null
    interactiveMs: number | null
    overallCategory: string | null
    analysisTimestamp: string | null
    lighthouseVersion: string | null
  }
}
