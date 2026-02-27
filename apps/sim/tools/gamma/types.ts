import type { ToolResponse } from '@/tools/types'

/**
 * Base parameters shared across all Gamma API tools.
 */
export interface GammaBaseParams {
  apiKey: string
}

/**
 * Parameters for the Generate a Gamma tool.
 */
export interface GammaGenerateParams extends GammaBaseParams {
  inputText: string
  textMode: 'generate' | 'condense' | 'preserve'
  format?: 'presentation' | 'document' | 'webpage' | 'social'
  themeId?: string
  numCards?: number
  cardSplit?: 'auto' | 'inputTextBreaks'
  cardDimensions?: string
  additionalInstructions?: string
  exportAs?: 'pdf' | 'pptx'
  folderIds?: string
  textAmount?: 'brief' | 'medium' | 'detailed' | 'extensive'
  textTone?: string
  textAudience?: string
  textLanguage?: string
  imageSource?:
    | 'aiGenerated'
    | 'pictographic'
    | 'unsplash'
    | 'webAllImages'
    | 'webFreeToUse'
    | 'webFreeToUseCommercially'
    | 'giphy'
    | 'placeholder'
    | 'noImages'
  imageModel?: string
  imageStyle?: string
}

/**
 * Parameters for the Generate from Template tool.
 */
export interface GammaGenerateFromTemplateParams extends GammaBaseParams {
  gammaId: string
  prompt: string
  themeId?: string
  exportAs?: 'pdf' | 'pptx'
  folderIds?: string
  imageModel?: string
  imageStyle?: string
}

/**
 * Parameters for the Check Generation Status tool.
 */
export interface GammaCheckStatusParams extends GammaBaseParams {
  generationId: string
}

/**
 * Parameters for the List Themes tool.
 */
export interface GammaListThemesParams extends GammaBaseParams {
  query?: string
  limit?: number
  after?: string
}

/**
 * Parameters for the List Folders tool.
 */
export interface GammaListFoldersParams extends GammaBaseParams {
  query?: string
  limit?: number
  after?: string
}

/**
 * Response for the Generate tool.
 */
export interface GammaGenerateResponse extends ToolResponse {
  output: {
    generationId: string
  }
}

/**
 * Response for the Generate from Template tool.
 */
export interface GammaGenerateFromTemplateResponse extends ToolResponse {
  output: {
    generationId: string
  }
}

/**
 * Response for the Check Status tool.
 */
export interface GammaCheckStatusResponse extends ToolResponse {
  output: {
    generationId: string
    status: 'pending' | 'completed' | 'failed'
    gammaUrl: string | null
    credits?: {
      deducted: number | null
      remaining: number | null
    }
    error?: {
      message: string | null
      statusCode: number | null
    }
  }
}

/**
 * Theme object from the Gamma API.
 */
export interface GammaTheme {
  id: string
  name: string
  type: string
  colorKeywords: string[]
  toneKeywords: string[]
}

/**
 * Response for the List Themes tool.
 */
export interface GammaListThemesResponse extends ToolResponse {
  output: {
    themes: GammaTheme[]
    hasMore: boolean
    nextCursor: string | null
  }
}

/**
 * Folder object from the Gamma API.
 */
export interface GammaFolder {
  id: string
  name: string
}

/**
 * Response for the List Folders tool.
 */
export interface GammaListFoldersResponse extends ToolResponse {
  output: {
    folders: GammaFolder[]
    hasMore: boolean
    nextCursor: string | null
  }
}

export type GammaResponse =
  | GammaGenerateResponse
  | GammaGenerateFromTemplateResponse
  | GammaCheckStatusResponse
  | GammaListThemesResponse
  | GammaListFoldersResponse
