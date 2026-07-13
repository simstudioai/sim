import type { FlintGetTaskParams, FlintGetTaskResponse, FlintTaskPage } from '@/tools/flint/types'
import { FLINT_API_BASE_URL, flintBaseParamFields, flintHeaders } from '@/tools/flint/utils'
import type { ToolConfig } from '@/tools/types'

const PAGE_OUTPUT_PROPERTIES = {
  slug: { type: 'string', description: 'Page slug (e.g., /about)' },
  previewUrl: {
    type: 'string',
    description: 'Preview deployment URL for the page',
    nullable: true,
  },
  editUrl: { type: 'string', description: 'Flint editor URL for the page', nullable: true },
  publishedUrl: {
    type: 'string',
    description: 'Published URL on the live domain (present when publish is enabled)',
    nullable: true,
  },
} as const

/**
 * Normalizes a page entry from the Flint API into a fully nullable page object.
 */
function toTaskPage(page: Record<string, unknown> | null | undefined): FlintTaskPage {
  return {
    slug: typeof page?.slug === 'string' ? page.slug : null,
    previewUrl: typeof page?.previewUrl === 'string' ? page.previewUrl : null,
    editUrl: typeof page?.editUrl === 'string' ? page.editUrl : null,
    publishedUrl: typeof page?.publishedUrl === 'string' ? page.publishedUrl : null,
  }
}

export const flintGetTaskTool: ToolConfig<FlintGetTaskParams, FlintGetTaskResponse> = {
  id: 'flint_get_task',
  name: 'Flint Get Task',
  description: 'Get the status and results of a background Flint agent task.',
  version: '1.0.0',

  params: {
    ...flintBaseParamFields,
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the task returned when it was created (e.g., bg-...)',
    },
  },

  request: {
    url: (params) =>
      `${FLINT_API_BASE_URL}/agent/tasks/${encodeURIComponent(params.taskId.trim())}`,
    method: 'GET',
    headers: (params) => flintHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskId: data.taskId ?? null,
        status: data.status ?? null,
        pagesCreated: Array.isArray(data.output?.pagesCreated)
          ? data.output.pagesCreated.map(toTaskPage)
          : [],
        pagesModified: Array.isArray(data.output?.pagesModified)
          ? data.output.pagesModified.map(toTaskPage)
          : [],
        pagesDeleted: Array.isArray(data.output?.pagesDeleted)
          ? data.output.pagesDeleted.map(toTaskPage)
          : [],
        errorMessage: data.errorMessage ?? null,
      },
    }
  },

  outputs: {
    taskId: { type: 'string', description: 'Identifier of the task' },
    status: { type: 'string', description: 'Task status: running, completed, or failed' },
    pagesCreated: {
      type: 'array',
      description: 'Pages created by the task (populated when completed)',
      items: { type: 'object', properties: PAGE_OUTPUT_PROPERTIES },
    },
    pagesModified: {
      type: 'array',
      description: 'Pages modified by the task (populated when completed)',
      items: { type: 'object', properties: PAGE_OUTPUT_PROPERTIES },
    },
    pagesDeleted: {
      type: 'array',
      description: 'Pages deleted by the task (populated when completed)',
      items: { type: 'object', properties: PAGE_OUTPUT_PROPERTIES },
    },
    errorMessage: {
      type: 'string',
      description: 'Error message when the task failed',
      optional: true,
    },
  },
}
