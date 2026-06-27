import { QuiverIcon } from '@/components/icons'
import { QuiverBlockDisplay } from '@/blocks/blocks/quiver.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { QuiverSvgResponse } from '@/tools/quiver/types'

export const QuiverBlock: BlockConfig<QuiverSvgResponse> = {
  ...QuiverBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Text to SVG', id: 'text_to_svg' },
        { label: 'Image to SVG', id: 'image_to_svg' },
        { label: 'List Models', id: 'list_models' },
      ],
      value: () => 'text_to_svg',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [{ label: 'Arrow Preview', id: 'arrow-preview' }],
      value: () => 'arrow-preview',
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Describe the SVG you want to generate...',
      required: { field: 'operation', value: 'text_to_svg' },
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'instructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Style or formatting guidance (optional)',
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'referenceFiles',
      title: 'Reference Images',
      type: 'file-upload',
      canonicalParamId: 'references',
      placeholder: 'Upload reference images (up to 4)',
      mode: 'basic',
      multiple: true,
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'referenceInput',
      title: 'Reference Images',
      type: 'short-input',
      canonicalParamId: 'references',
      placeholder: 'Reference files from previous blocks',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'n',
      title: 'Number of Outputs',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'text_to_svg' },
    },
    {
      id: 'imageFile',
      title: 'Image',
      type: 'file-upload',
      canonicalParamId: 'image',
      placeholder: 'Upload an image to vectorize',
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'image_to_svg' },
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'imageInput',
      title: 'Image',
      type: 'short-input',
      canonicalParamId: 'image',
      placeholder: 'Reference image from previous blocks',
      mode: 'advanced',
      required: { field: 'operation', value: 'image_to_svg' },
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'autoCrop',
      title: 'Auto Crop',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'targetSize',
      title: 'Target Size (px)',
      type: 'short-input',
      placeholder: '128-4096',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'image_to_svg' },
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'topP',
      title: 'Top P',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'maxOutputTokens',
      title: 'Max Output Tokens',
      type: 'short-input',
      placeholder: '131072',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'presencePenalty',
      title: 'Presence Penalty',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['text_to_svg', 'image_to_svg'] },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your QuiverAI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['quiver_text_to_svg', 'quiver_image_to_svg', 'quiver_list_models'],
    config: {
      tool: (params: Record<string, string>) => `quiver_${params.operation}`,
      params: (params: Record<string, unknown>) => {
        const {
          references,
          image,
          topP,
          maxOutputTokens,
          presencePenalty,
          targetSize,
          autoCrop,
          ...rest
        } = params

        const normalizedRefs = normalizeFileInput(references)
        const normalizedImage = normalizeFileInput(image, { single: true })

        return {
          ...(rest as Record<string, unknown>),
          ...(normalizedRefs ? { references: normalizedRefs } : {}),
          ...(normalizedImage ? { image: normalizedImage } : {}),
          ...(rest.n ? { n: Number(rest.n) } : {}),
          ...(rest.temperature ? { temperature: Number(rest.temperature) } : {}),
          ...(topP ? { top_p: Number(topP) } : {}),
          ...(maxOutputTokens ? { max_output_tokens: Number(maxOutputTokens) } : {}),
          ...(presencePenalty ? { presence_penalty: Number(presencePenalty) } : {}),
          ...(targetSize ? { target_size: Number(targetSize) } : {}),
          ...(autoCrop === 'true' ? { auto_crop: true } : {}),
        }
      },
    },
  },
  inputs: {
    prompt: { type: 'string' },
    instructions: { type: 'string' },
    references: { type: 'file' },
    image: { type: 'file' },
  },
  outputs: {
    file: {
      type: 'file',
      description: 'First generated SVG file',
    },
    files: {
      type: 'json',
      description: 'All generated SVG files (when n > 1)',
    },
    svgContent: {
      type: 'string',
      description: 'Raw SVG markup content',
    },
    id: {
      type: 'string',
      description: 'Request ID',
    },
    usage: {
      type: 'json',
      description: 'Token usage statistics',
    },
    models: {
      type: 'json',
      description: 'List of available models (list_models operation only)',
    },
  },
}

export const QuiverBlockMeta = {
  tags: ['image-generation'],
  url: 'https://quiver.ai',
  templates: [
    {
      icon: QuiverIcon,
      title: 'Quiver SVG icon generator',
      prompt:
        'Build a workflow that takes a product name and brand color as inputs, generates a matching SVG icon with Quiver, and saves it to the files store.',
      modules: ['files', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['design', 'automation'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver diagram creator',
      prompt:
        'Create a workflow that reads structured data from a table and uses Quiver to generate a clean SVG diagram visualizing the data, then attaches it to a Slack message.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['design', 'reporting'],
    },
    {
      icon: QuiverIcon,
      title: 'Quiver image vectorizer',
      prompt:
        'Build a workflow that accepts a raster image upload, vectorizes it to SVG with Quiver, and returns the clean SVG for use in presentations or exports.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['design', 'automation'],
    },
  ],
  skills: [
    {
      name: 'generate-brand-icon',
      description: 'Generate a clean SVG icon from a text prompt and save it to the files store.',
      content:
        '# Generate Brand Icon\n\nTurn a text description into a production-ready SVG icon using Quiver text-to-SVG.\n\n## Steps\n1. Collect the icon concept (for example, a product name plus a brand color and style cues).\n2. Run the text_to_svg operation with a focused prompt that names the subject, color palette, and visual style (flat, line, filled).\n3. Optionally set n greater than 1 to generate several variations to choose from.\n4. Save the returned SVG file to the files store, or pass svgContent downstream for embedding.\n\n## Output\nReport the saved file location and the request id. When multiple variations are generated, list each so the user can pick one.',
    },
    {
      name: 'vectorize-raster-image',
      description: 'Convert an uploaded raster image (PNG or JPG) into a clean editable SVG.',
      content:
        '# Vectorize Raster Image\n\nConvert a bitmap logo or graphic into a scalable SVG with Quiver image-to-SVG.\n\n## Steps\n1. Accept the raster image upload and pass it as the image input.\n2. Run the image_to_svg operation, optionally setting auto_crop and a target_size to tighten the output.\n3. Inspect svgContent for fidelity; rerun with adjusted instructions if details are lost.\n4. Save the SVG file for use in presentations, exports, or the web.\n\n## Output\nReturn the vectorized SVG file and confirm dimensions. Note any visual elements that did not vectorize cleanly.',
    },
    {
      name: 'create-data-diagram',
      description: 'Generate an SVG diagram that visualizes structured data, then share it.',
      content:
        '# Create Data Diagram\n\nProduce a clean SVG diagram from structured data and attach it to a message.\n\n## Steps\n1. Read the structured data (for example, rows from a table) that should be visualized.\n2. Summarize the data into a precise prompt describing the diagram type and relationships.\n3. Run the text_to_svg operation to generate the diagram.\n4. Save the SVG file and attach it to the target channel or document.\n\n## Output\nShare the generated diagram file and a one-line description of what it depicts.',
    },
  ],
} as const satisfies BlockMeta
