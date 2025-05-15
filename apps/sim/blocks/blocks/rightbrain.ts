import { RightBrainIcon } from '@/components/icons'
import { RightBrainRunTaskResponse } from '@/tools/rightbrain/types'
import { BlockConfig } from '../types'

export const RightBrainBlock: BlockConfig<RightBrainRunTaskResponse> = {
  type: 'rightbrain',
  name: 'Rightbrain',
  description: 'Run a Rightbrain AI task',
  longDescription:
    'Rightbrain allows you to build LLM features in minutes and instantly deploy them for specific tasks across any app or workflow without extended development cycles.',
  docsLink: 'https://docs.rightbrain.ai/intro',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: RightBrainIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'Task URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Rightbrain task URL',
    },
    {
      id: 'inputs',
      title: 'Task inputs',
      type: 'code',
      layout: 'full',
      placeholder: 'The task_input JSON object',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Rightbrain API key',
      password: true,
    },
  ],
  tools: {
    access: ['rightbrain_run_task'],
  },
  inputs: {
    url: { type: 'string', required: true },
    inputs: { type: 'json', required: true },
    apiKey: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        charged_credits: 'any',
        created: 'string',
        id: 'string',
        input_processor_timing: 'any',
        input_tokens: 'number',
        llm_call_timing: 'any',
        output_tokens: 'number',
        response: 'json',
        run_data: 'json',
        task_id: 'string',
        task_revision_id: 'string',
        total_tokens: 'number',
        is_error: 'any',
      },
    },
  },
}
