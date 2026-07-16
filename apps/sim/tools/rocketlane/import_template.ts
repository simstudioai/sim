import {
  mapProject,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneImportTemplateParams,
  type RocketlaneProjectResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneImportTemplateTool: ToolConfig<
  RocketlaneImportTemplateParams,
  RocketlaneProjectResponse
> = {
  id: 'rocketlane_import_template',
  name: 'Rocketlane Import Template',
  description: 'Import a project template into an existing Rocketlane project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the project to import the template into',
    },
    templateId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the template to import',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Date on which the template goes into effect for the project (YYYY-MM-DD)',
    },
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Prefix distinguishing which phase or task corresponds to this template when importing multiple templates',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/projects/${encodeURIComponent(String(params.projectId))}/import-template`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const source: Record<string, unknown> = {
        templateId: params.templateId,
        startDate: params.startDate,
      }
      if (params.prefix) source.prefix = params.prefix
      return [source]
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { project: mapProject(data) },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The project after the template import (including its sources)',
      properties: PROJECT_OUTPUT_PROPERTIES,
    },
  },
}
