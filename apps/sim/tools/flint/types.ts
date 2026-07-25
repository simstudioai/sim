import type { ToolResponse } from '@/tools/types'

export interface FlintBaseParams {
  apiKey: string
}

export interface FlintCreateTaskParams extends FlintBaseParams {
  siteId: string
  prompt: string
  callbackUrl?: string
  publish?: boolean
}

/**
 * One page to generate when running a `generate_pages` task.
 */
export interface FlintGeneratePagesItem {
  targetPageSlug: string
  context: string
}

export interface FlintGeneratePagesParams extends FlintBaseParams {
  siteId: string
  templatePageSlug: string
  items: FlintGeneratePagesItem[] | string
  callbackUrl?: string
  publish?: boolean
}

export interface FlintGetTaskParams extends FlintBaseParams {
  taskId: string
}

/**
 * Page reference returned by Flint for created, modified, and deleted pages.
 */
export interface FlintTaskPage {
  slug: string | null
  previewUrl: string | null
  editUrl: string | null
  publishedUrl: string | null
}

/**
 * Shared output shape of the two task-creation endpoints.
 */
export interface FlintTaskCreatedOutput {
  taskId: string | null
  status: string | null
  createdAt: string | null
}

export interface FlintCreateTaskResponse extends ToolResponse {
  output: FlintTaskCreatedOutput
}

export interface FlintGeneratePagesResponse extends ToolResponse {
  output: FlintTaskCreatedOutput
}

export interface FlintGetTaskResponse extends ToolResponse {
  output: {
    taskId: string | null
    status: string | null
    pagesCreated: FlintTaskPage[]
    pagesModified: FlintTaskPage[]
    pagesDeleted: FlintTaskPage[]
    errorMessage: string | null
  }
}
