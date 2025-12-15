/**
 * Base parameters for all Figma API requests
 */
export interface FigmaBaseParams {
  accessToken: string
  fileKey: string
}

/**
 * Parameters for getting a Figma file
 */
export interface FigmaGetFileParams extends FigmaBaseParams {
  depth?: number
}

/**
 * Output for getting a Figma file
 */
export interface FigmaGetFileOutput {
  name: string
  lastModified: string
  thumbnailUrl: string
  version: string
  document: Record<string, unknown>
  components: Record<string, unknown>
  styles: Record<string, unknown>
}

/**
 * Response for getting a Figma file
 */
export interface FigmaGetFileResponse {
  success: boolean
  output: FigmaGetFileOutput
}

/**
 * Parameters for getting specific nodes from a Figma file
 */
export interface FigmaGetNodesParams extends FigmaBaseParams {
  nodeIds: string
  depth?: number
}

/**
 * Output for getting specific nodes
 */
export interface FigmaGetNodesOutput {
  name: string
  lastModified: string
  nodes: Record<string, unknown>
}

/**
 * Response for getting specific nodes
 */
export interface FigmaGetNodesResponse {
  success: boolean
  output: FigmaGetNodesOutput
}

/**
 * Parameters for exporting images from a Figma file
 */
export interface FigmaExportImagesParams extends FigmaBaseParams {
  nodeIds: string
  format: 'png' | 'svg' | 'pdf' | 'jpg'
  scale?: number
}

/**
 * Exported image file
 */
export interface FigmaExportedFile {
  name: string
  mimeType: string
  data: Buffer
  size: number
  nodeId: string
}

/**
 * Output for exporting images
 */
export interface FigmaExportImagesOutput {
  files: FigmaExportedFile[]
  metadata: {
    format: string
    scale: number
    nodeCount: number
  }
}

/**
 * Response for exporting images
 */
export interface FigmaExportImagesResponse {
  success: boolean
  output: FigmaExportImagesOutput
}

/**
 * Parameters for listing comments on a Figma file
 */
export interface FigmaListCommentsParams extends FigmaBaseParams {}

/**
 * Comment structure from Figma API
 */
export interface FigmaComment {
  id: string
  message: string
  file_key: string
  parent_id?: string
  user: {
    id: string
    handle: string
    img_url: string
  }
  created_at: string
  resolved_at?: string
  order_id?: string
  client_meta?: {
    node_id?: string
    node_offset?: { x: number; y: number }
  }
}

/**
 * Output for listing comments
 */
export interface FigmaListCommentsOutput {
  comments: FigmaComment[]
  metadata: {
    commentCount: number
  }
}

/**
 * Response for listing comments
 */
export interface FigmaListCommentsResponse {
  success: boolean
  output: FigmaListCommentsOutput
}

/**
 * Parameters for adding a comment to a Figma file
 */
export interface FigmaAddCommentParams extends FigmaBaseParams {
  message: string
  nodeId?: string
}

/**
 * Output for adding a comment
 */
export interface FigmaAddCommentOutput {
  comment: FigmaComment
}

/**
 * Response for adding a comment
 */
export interface FigmaAddCommentResponse {
  success: boolean
  output: FigmaAddCommentOutput
}

/**
 * Parameters for getting components from a Figma file
 */
export interface FigmaGetComponentsParams extends FigmaBaseParams {}

/**
 * Component structure from Figma API
 */
export interface FigmaComponent {
  key: string
  name: string
  description: string
  node_id: string
  thumbnail_url: string
  created_at: string
  updated_at: string
  containing_frame?: {
    name: string
    nodeId: string
    pageName: string
    pageId: string
  }
}

/**
 * Output for getting components
 */
export interface FigmaGetComponentsOutput {
  components: FigmaComponent[]
  metadata: {
    componentCount: number
  }
}

/**
 * Response for getting components
 */
export interface FigmaGetComponentsResponse {
  success: boolean
  output: FigmaGetComponentsOutput
}

/**
 * Parameters for getting styles from a Figma file
 */
export interface FigmaGetStylesParams extends FigmaBaseParams {}

/**
 * Style structure from Figma API
 */
export interface FigmaStyle {
  key: string
  name: string
  description: string
  style_type: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID'
  node_id: string
  thumbnail_url: string
  created_at: string
  updated_at: string
}

/**
 * Output for getting styles
 */
export interface FigmaGetStylesOutput {
  styles: FigmaStyle[]
  metadata: {
    styleCount: number
  }
}

/**
 * Response for getting styles
 */
export interface FigmaGetStylesResponse {
  success: boolean
  output: FigmaGetStylesOutput
}

/**
 * Union type for all Figma responses
 */
export type FigmaResponse =
  | FigmaGetFileResponse
  | FigmaGetNodesResponse
  | FigmaExportImagesResponse
  | FigmaListCommentsResponse
  | FigmaAddCommentResponse
  | FigmaGetComponentsResponse
  | FigmaGetStylesResponse
