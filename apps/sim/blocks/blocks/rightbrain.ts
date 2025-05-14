import { RightBrainIcon } from '@/components/icons'
import { RightBrainRunTaskResponse } from '@/tools/rightbrain/types'
import { BlockConfig } from '../types'

export const RightBrainBlock: BlockConfig<RightBrainRunTaskResponse> = {
  type: 'rightbrain',
  name: 'Rightbrain',
  description: 'Run RB task',
  longDescription:
    'Rightbrain lets you reliably deploy LLMs for specific tasks across any app or workflow by turning simple instructions into scalable APIs.',
  docsLink: 'https://docs.rightbrain.ai/intro',
  category: 'blocks',
  bgColor: '#E0E0E0',
  icon: RightBrainIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'Task URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter URL',
    },
    {
      id: 'inputs',
      title: 'Task inputs',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter inputs JSON...',
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
