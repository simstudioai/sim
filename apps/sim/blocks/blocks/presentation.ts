import { PresentationIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export interface PresentationResponse extends ToolResponse {
  output: {
    presentationFile?: any
    presentationId?: string
    message?: string
  }
}

export const PresentationBlock: BlockConfig<PresentationResponse> = {
  type: 'presentation',
  name: 'Presentation',
  description: 'Create presentations',
  longDescription:
    'Integrate Presentation creation into the workflow. Can create presentations with customizable slides, tone, and verbosity.',
  category: 'tools',
  bgColor: '#F4B400',
  icon: PresentationIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [{ label: 'Create', id: 'create' }],
      value: () => 'create',
    },
    {
      id: 'numberOfSlides',
      title: 'Number of Slides',
      type: 'short-input',
      placeholder: 'Enter number of slides',
      required: true,
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'tone',
      title: 'Tone',
      type: 'dropdown',
      options: [{ label: 'Professional', id: 'professional' }],
      value: () => 'professional',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'verbosity',
      title: 'Verbosity',
      type: 'dropdown',
      options: [{ label: 'Standard', id: 'standard' }],
      value: () => 'standard',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'template',
      title: 'Templates',
      type: 'dropdown',
      options: [{ label: 'Position2', id: 'position2' }],
      value: () => 'position2',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter presentation content',
      condition: { field: 'operation', value: 'create' },
    },
  ],
  tools: {
    access: ['presentation_create'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create':
            return 'presentation_create'
          default:
            return 'presentation_create'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    numberOfSlides: { type: 'number', description: 'Number of slides to create' },
    tone: { type: 'string', description: 'Tone of the presentation' },
    verbosity: { type: 'string', description: 'Verbosity level of the presentation' },
    template: { type: 'string', description: 'Presentation template' },
    content: { type: 'string', description: 'Presentation content' },
  },
  outputs: {
    presentationFile: { type: 'json', description: 'Presentation file' },
    presentationId: { type: 'string', description: 'Presentation ID' },
    message: { type: 'string', description: 'Status message' },
  },
}
