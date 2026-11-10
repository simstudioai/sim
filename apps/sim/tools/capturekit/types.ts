import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/** PageMetadata read from a CaptureKit API response. */
export interface CaptureKitPageMetadata {
  title: string | null
  description: string | null
  favicon: string | null
  ogImage: string | null
}

/** PageLinks read from a CaptureKit API response. */
export interface CaptureKitPageLinks {
  internal: string[]
  external: string[]
  social: string[]
}

export const CAPTURE_KIT_PAGE_METADATA_OUTPUT_PROPERTIES = {
  title: {
    type: 'string',
    description: 'Page title',
    optional: true,
  },
  description: {
    type: 'string',
    description: 'Meta description',
    optional: true,
  },
  favicon: {
    type: 'string',
    description: 'Favicon URL',
    optional: true,
  },
  ogImage: {
    type: 'string',
    description: 'Open Graph image URL',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CAPTURE_KIT_PAGE_LINKS_OUTPUT_PROPERTIES = {
  internal: {
    type: 'array',
    description: 'Links to the same site',
    optional: true,
    items: { type: 'string' },
  },
  external: {
    type: 'array',
    description: 'Links to other sites',
    optional: true,
    items: { type: 'string' },
  },
  social: {
    type: 'array',
    description: 'Links to social profiles',
    optional: true,
    items: { type: 'string' },
  },
} as const satisfies Record<string, OutputProperty>

export interface CaptureKitScreenshotParams {
  apiKey: string
  url: string
  format?: string
  fullPage?: boolean
  device?: string
  selector?: string
  viewportWidth?: number
  viewportHeight?: number
  delay?: number
  removeCookieBanners?: boolean
  removeAds?: boolean
}

export interface CaptureKitScreenshotResponse extends ToolResponse {
  output: {
    file: ToolFileData
  }
}

export interface CaptureKitExtractContentParams {
  apiKey: string
  url: string
  includeMarkdown?: boolean
  removeCookieBanners?: boolean
  removeAds?: boolean
}

export interface CaptureKitExtractContentResponse extends ToolResponse {
  output: {
    metadata: CaptureKitPageMetadata | null
    links: CaptureKitPageLinks | null
    markdown: string | null
  }
}

export interface CaptureKitFetchHtmlParams {
  apiKey: string
  url: string
}

export interface CaptureKitFetchHtmlResponse extends ToolResponse {
  output: {
    html: string | null
  }
}

export interface CaptureKitAnalyzeWebsiteParams {
  apiKey: string
  url: string
  customPrompt?: string
}

export interface CaptureKitAnalyzeWebsiteResponse extends ToolResponse {
  output: {
    summary: string | null
    valueProposition: string | null
    businessType: string | null
    targetAudience: string | null
    callToAction: string | null
    keyFeatures: string[]
    categories: string[]
    useCases: string[]
    emails: string[]
    phoneNumbers: string[]
  }
}
