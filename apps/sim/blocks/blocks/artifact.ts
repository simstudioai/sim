import { ArtifactIcon } from '@/components/icons'
import type { BlockConfig, ParamType } from '@/blocks/types'
import {
  getModelOptions,
  getProviderCredentialSubBlocks,
  PROVIDER_CREDENTIAL_INPUTS,
} from '@/blocks/utils'
import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

interface ArtifactResponse extends ToolResponse {
  output: {
    file: UserFile
    url: string
    shareUrl?: string | null
    title: string
    model: string
  }
}

export const ArtifactBlock: BlockConfig<ArtifactResponse> = {
  type: 'artifact',
  name: 'Artifact',
  description: 'Create an HTML artifact',
  longDescription:
    'This is a core workflow block. Generate a polished, self-contained HTML page from workflow outputs using an LLM. Artifacts are saved to the workspace Files module in an Artifacts folder, render in the sandboxed HTML viewer, and can optionally get a public share link.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/artifact',
  category: 'blocks',
  bgColor: '#4D5FFF',
  icon: ArtifactIcon,
  subBlocks: [
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Weekly metrics report',
      required: true,
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Data to present — reference outputs like <blockName.output>',
      required: true,
    },
    {
      id: 'designInstructions',
      title: 'Design Instructions',
      type: 'long-input',
      placeholder: 'Optional: describe the desired look and layout',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
      required: true,
      defaultValue: 'claude-sonnet-5',
      options: getModelOptions,
    },
    ...getProviderCredentialSubBlocks(),
    {
      id: 'createShareLink',
      title: 'Create Share Link',
      type: 'switch',
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Defaults to the artifact title',
      mode: 'advanced',
    },
  ],
  tools: {
    access: ['artifact_generate'],
    config: {
      tool: () => 'artifact_generate',
      params: (params) => ({
        ...params,
        createShareLink: params.createShareLink === true,
      }),
    },
  },
  inputs: {
    title: { type: 'string' as ParamType, description: 'Artifact title' },
    content: {
      type: 'string' as ParamType,
      description: 'Content/data to present in the artifact',
    },
    designInstructions: {
      type: 'string' as ParamType,
      description: 'Optional design and layout instructions',
    },
    model: { type: 'string' as ParamType, description: 'AI model to use' },
    ...PROVIDER_CREDENTIAL_INPUTS,
    createShareLink: {
      type: 'boolean' as ParamType,
      description: 'Create a public share link for the artifact',
    },
    fileName: { type: 'string' as ParamType, description: 'File name for the artifact' },
  },
  outputs: {
    file: { type: 'file', description: 'The generated HTML artifact file' },
    url: { type: 'string', description: 'URL to view the artifact' },
    shareUrl: { type: 'string', description: 'Public share link when enabled' },
    title: { type: 'string', description: 'Artifact title' },
    model: { type: 'string', description: 'Model used for generation' },
  },
}
