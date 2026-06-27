import { QuiverIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const QuiverBlockDisplay = {
  type: 'quiver',
  name: 'Quiver',
  description: 'Generate and vectorize SVGs',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: QuiverIcon,
  longDescription:
    'Generate SVG images from text prompts or vectorize raster images into SVGs using QuiverAI. Supports reference images, style instructions, and multiple output generation.',
  docsLink: 'https://docs.sim.ai/integrations/quiver',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

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
