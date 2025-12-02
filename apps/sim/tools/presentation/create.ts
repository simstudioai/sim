import type {
    PresentationCreateParams,
    PresentationCreateResponse,
  } from '@/tools/presentation/types'
  import type { ToolConfig } from '@/tools/types'
  
  export const createTool: ToolConfig<PresentationCreateParams, PresentationCreateResponse> = {
    id: 'presentation_create',
    name: 'Create Presentation',
    description: 'Create a presentation with specified number of slides, tone, and verbosity',
    version: '1.0.0',
  
    params: {
      operation: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Operation to perform (e.g., create)',
      },
      numberOfSlides: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Number of slides to create',
      },
      tone: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Tone of the presentation (e.g., professional)',
      },
      verbosity: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Verbosity level of the presentation (e.g., standard)',
      },
      template: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Presentation template (e.g., Position2)',
      },
      content: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Presentation content',
      },
    },
  
    request: {
      url: () => {
        return '/api/tools/presentation/create'
      },
      method: 'POST',
      headers: () => {
        return {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }
      },
      body: (params: PresentationCreateParams) => {
        return {
          operation: params.operation,
          numberOfSlides: params.numberOfSlides,
          tone: params.tone,
          verbosity: params.verbosity,
          template: params.template,
          content: params.content,
        }
      },
    },
  
    transformResponse: async (
      response: Response,
      params?: PresentationCreateParams
    ): Promise<PresentationCreateResponse> => {
      const data = await response.json()
  
      // Ensure proper file format when present; emit standard file shape
      let presentationFile = data.presentationFile
      if (presentationFile?.data) {
        const base64Url = presentationFile.data as string
        const filename = presentationFile.filename || 'presentation.pptx'
        const mimeType =
          presentationFile.mimetype ||
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  
        // Best-effort size estimate from base64/base64url length (without decoding)
        const unpaddedLen = base64Url.replace(/=+$/, '').length
        const estimatedSize = Math.floor((unpaddedLen * 3) / 4)
  
        presentationFile = {
          content: base64Url, // base64Url string passed through as-is
          fileType: mimeType,
          size: estimatedSize,
          name: filename,
          binary: true,
          metadata: {
            filename,
            mimetype: mimeType,
          },
        }
      }
  
      return {
        success: true,
        output: {
          presentationFile: presentationFile,
          presentationId: data.presentationId,
          message: data.message,
        },
      }
    },
  
    outputs: {
      presentationFile: { type: 'file', description: 'Presentation file' },
      presentationId: { type: 'string', description: 'Presentation ID' },
      message: { type: 'string', description: 'Status message' },
    },
  }