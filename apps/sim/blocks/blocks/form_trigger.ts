import type { SVGProps } from 'react'
import { createElement } from 'react'
import { FileText } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const FormTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(FileText, props)

export const FormTriggerBlock: BlockConfig = {
  type: 'form_trigger',
  name: 'Deployed Form',
  description: 'Public form that triggers workflow when submitted',
  longDescription:
    'Create a public form at sim.ai/form/[id] that users can fill out to trigger your workflow. Form submissions provide structured data as workflow input.',
  bestPractices: `
  - Perfect for lead generation, feedback collection, support requests, and user onboarding
  - Form fields become available as workflow variables: <form.fieldName>
  - Configure validation, styling, and success messages
  - Form submissions are rate-limited based on your plan
  - Each form gets a unique URL that can be shared publicly
  `,
  category: 'triggers',
  bgColor: '#8B5CF6',
  icon: FormTriggerIcon,
  subBlocks: [
    {
      id: 'formConfig',
      title: 'Form Configuration',
      type: 'form-config',
      layout: 'full',
      description: 'Configure form fields, validation, and display settings.',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    // Dynamic outputs will be derived from form configuration
    formData: {
      type: 'json',
      description: 'The submitted form data',
    },
    metadata: {
      type: 'json',
      description: 'Form submission metadata (timestamp, IP, etc.)',
    },
  },
  triggers: {
    enabled: true,
    available: ['form'],
  },
}
