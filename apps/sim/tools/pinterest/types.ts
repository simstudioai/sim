import type { ToolResponse } from '@/tools/types'

/**
 * Parameters for creating a Pinterest pin
 */
export interface CreatePinParams {
  accessToken: string
  board_id: string
  title: string
  description: string
  media_url: string
  link?: string
  alt_text?: string
}

/**
 * Pinterest pin object
 */
export interface PinterestPin {
  id: string
  created_at: string
  board_id: string
  title: string
  description: string
  link: string
  media: {
    images: {
      [key: string]: {
        width: number
        height: number
        url: string
      }
    }
  }
}

/**
 * Response from creating a pin
 */
export interface CreatePinResponse extends ToolResponse {
  output: {
    pin?: PinterestPin
    pin_id?: string
    pin_url?: string
  }
}

/**
 * Generic Pinterest response type for blocks
 */
export type PinterestResponse = {
  success: boolean
  output: {
    pin?: PinterestPin
    pin_id?: string
    pin_url?: string
  }
  error?: string
}

/**
 * Pinterest board object
 */
export interface PinterestBoard {
  id: string
  name: string
  description: string
  privacy: string
  owner: {
    username: string
  }
}

/**
 * Parameters for listing boards
 */
export interface ListBoardsParams {
  accessToken: string
}

/**
 * Response from listing boards
 */
export interface ListBoardsResponse extends ToolResponse {
  output: {
    boards?: PinterestBoard[]
  }
}
