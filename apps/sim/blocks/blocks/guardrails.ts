import { ShieldCheckIcon } from '@/components/icons'
import { isHosted } from '@/lib/environment'
import type { BlockConfig } from '@/blocks/types'
import { getBaseModelProviders, getHostedModels, getProviderIcon } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'
import type { ToolResponse } from '@/tools/types'

const getCurrentOllamaModels = () => {
  const providersState = useProvidersStore.getState()
  return providersState.providers.ollama.models
}

export interface GuardrailsResponse extends ToolResponse {
  output: {
    passed: boolean
    validationType: string
    input: string
    error?: string
    score?: number
    reasoning?: string
  }
}

export const GuardrailsBlock: BlockConfig<GuardrailsResponse> = {
  type: 'guardrails',
  name: 'Guardrails',
  description: 'Validate content with guardrails',
  longDescription:
    'Validate content using guardrails. Check if content is valid JSON, matches a regex pattern, detect hallucinations using RAG + LLM scoring, or detect PII.',
  bestPractices: `
  - Reference block outputs using <blockName.output> syntax in the Content field
  - Use JSON validation to ensure structured output from LLMs before parsing
  - Use regex validation for format checking (emails, phone numbers, URLs, etc.)
  - Use hallucination check to validate LLM outputs against knowledge base content
  - Use PII detection to block or mask sensitive personal information
  - Access validation result with <guardrails.passed> (true/false)
  - For hallucination check, access <guardrails.score> (0-10 confidence) and <guardrails.reasoning>
  - For PII detection, access <guardrails.detectedEntities> and <guardrails.maskedText>
  - Chain with Condition block to handle validation failures
  `,
  docsLink: 'https://docs.sim.ai/blocks/guardrails',
  category: 'blocks',
  bgColor: '#3D642D',
  icon: ShieldCheckIcon,
  subBlocks: [
    {
      id: 'input',
      title: 'Content to Validate',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter content to validate',
      required: true,
    },
    {
      id: 'validationType',
      title: 'Validation Type',
      type: 'dropdown',
      layout: 'full',
      required: true,
      options: [
        { label: 'Valid JSON', id: 'json' },
        { label: 'Regex Match', id: 'regex' },
        { label: 'Hallucination Check', id: 'hallucination' },
        { label: 'PII Detection', id: 'pii' },
      ],
      defaultValue: 'json',
    },
    {
      id: 'regex',
      title: 'Regex Pattern',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
      required: true,
      condition: {
        field: 'validationType',
        value: ['regex'],
      },
    },
    {
      id: 'knowledgeBaseId',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      layout: 'full',
      placeholder: 'Select knowledge base',
      multiSelect: false,
      required: true,
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      layout: 'half',
      placeholder: 'Type or select a model...',
      required: true,
      options: () => {
        const providersState = useProvidersStore.getState()
        const ollamaModels = providersState.providers.ollama.models
        const openrouterModels = providersState.providers.openrouter.models
        const baseModels = Object.keys(getBaseModelProviders())
        const allModels = Array.from(new Set([...baseModels, ...ollamaModels, ...openrouterModels]))

        return allModels.map((model) => {
          const icon = getProviderIcon(model)
          return { label: model, id: model, ...(icon && { icon }) }
        })
      },
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
    },
    {
      id: 'threshold',
      title: 'Confidence',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 10,
      step: 1,
      defaultValue: 3,
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
    },
    {
      id: 'topK',
      title: 'Number of Chunks to Retrieve',
      type: 'slider',
      layout: 'full',
      min: 1,
      max: 20,
      step: 1,
      defaultValue: 5,
      mode: 'advanced',
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
      required: true,
      // Show API key field only for hallucination validation
      // Hide for hosted models and Ollama models
      condition: () => {
        const baseCondition = {
          field: 'validationType' as const,
          value: ['hallucination'],
        }

        if (isHosted) {
          // In hosted mode, hide for hosted models
          return {
            ...baseCondition,
            and: {
              field: 'model' as const,
              value: getHostedModels(),
              not: true, // Show for all models EXCEPT hosted ones
            },
          }
        }
        // In self-hosted mode, hide for Ollama models
        return {
          ...baseCondition,
          and: {
            field: 'model' as const,
            value: getCurrentOllamaModels(),
            not: true, // Show for all models EXCEPT Ollama ones
          },
        }
      },
    },
    {
      id: 'piiEntityTypes',
      title: 'PII Types to Detect',
      type: 'grouped-checkbox-list',
      layout: 'full',
      maxHeight: 400,
      options: [
        // Common PII types
        { label: 'Person name', id: 'PERSON', group: 'Common' },
        { label: 'Email address', id: 'EMAIL_ADDRESS', group: 'Common' },
        { label: 'Phone number', id: 'PHONE_NUMBER', group: 'Common' },
        { label: 'Location', id: 'LOCATION', group: 'Common' },
        { label: 'Date or time', id: 'DATE_TIME', group: 'Common' },
        { label: 'IP address', id: 'IP_ADDRESS', group: 'Common' },
        { label: 'URL', id: 'URL', group: 'Common' },
        { label: 'Credit card number', id: 'CREDIT_CARD', group: 'Common' },
        { label: 'International bank account number (IBAN)', id: 'IBAN_CODE', group: 'Common' },
        { label: 'Cryptocurrency wallet address', id: 'CRYPTO', group: 'Common' },
        { label: 'Medical license number', id: 'MEDICAL_LICENSE', group: 'Common' },
        { label: 'Nationality / religion / political group', id: 'NRP', group: 'Common' },

        // USA
        { label: 'US bank account number', id: 'US_BANK_NUMBER', group: 'USA' },
        { label: 'US driver license number', id: 'US_DRIVER_LICENSE', group: 'USA' },
        {
          label: 'US individual taxpayer identification number (ITIN)',
          id: 'US_ITIN',
          group: 'USA',
        },
        { label: 'US passport number', id: 'US_PASSPORT', group: 'USA' },
        { label: 'US Social Security number', id: 'US_SSN', group: 'USA' },

        // UK
        { label: 'UK National Insurance number', id: 'UK_NINO', group: 'UK' },
        { label: 'UK NHS number', id: 'UK_NHS', group: 'UK' },

        // Spain
        { label: 'Spanish NIF number', id: 'ES_NIF', group: 'Spain' },
        { label: 'Spanish NIE number', id: 'ES_NIE', group: 'Spain' },

        // Italy
        { label: 'Italian fiscal code', id: 'IT_FISCAL_CODE', group: 'Italy' },
        { label: 'Italian driver license', id: 'IT_DRIVER_LICENSE', group: 'Italy' },
        { label: 'Italian identity card', id: 'IT_IDENTITY_CARD', group: 'Italy' },
        { label: 'Italian passport', id: 'IT_PASSPORT', group: 'Italy' },

        // Poland
        { label: 'Polish PESEL', id: 'PL_PESEL', group: 'Poland' },

        // Singapore
        { label: 'Singapore NRIC/FIN', id: 'SG_NRIC_FIN', group: 'Singapore' },

        // Australia
        { label: 'Australian business number (ABN)', id: 'AU_ABN', group: 'Australia' },
        { label: 'Australian company number (ACN)', id: 'AU_ACN', group: 'Australia' },
        { label: 'Australian tax file number (TFN)', id: 'AU_TFN', group: 'Australia' },
        { label: 'Australian Medicare number', id: 'AU_MEDICARE', group: 'Australia' },

        // India
        { label: 'Indian Aadhaar', id: 'IN_AADHAAR', group: 'India' },
        { label: 'Indian PAN', id: 'IN_PAN', group: 'India' },
        { label: 'Indian vehicle registration', id: 'IN_VEHICLE_REGISTRATION', group: 'India' },
        { label: 'Indian voter number', id: 'IN_VOTER', group: 'India' },
        { label: 'Indian passport', id: 'IN_PASSPORT', group: 'India' },
      ],
      condition: {
        field: 'validationType',
        value: ['pii'],
      },
    },
    {
      id: 'piiMode',
      title: 'Action',
      type: 'dropdown',
      layout: 'full',
      required: true,
      options: [
        { label: 'Block Request', id: 'block' },
        { label: 'Mask PII', id: 'mask' },
      ],
      defaultValue: 'block',
      condition: {
        field: 'validationType',
        value: ['pii'],
      },
    },
    {
      id: 'piiLanguage',
      title: 'Language',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'English', id: 'en' },
        { label: 'Spanish', id: 'es' },
        { label: 'Italian', id: 'it' },
        { label: 'Polish', id: 'pl' },
        { label: 'Finnish', id: 'fi' },
      ],
      defaultValue: 'en',
      condition: {
        field: 'validationType',
        value: ['pii'],
      },
    },
  ],
  tools: {
    access: ['guardrails_validate'],
  },
  inputs: {
    input: {
      type: 'string',
      description: 'Content to validate (automatically receives input from wired block)',
    },
    validationType: {
      type: 'string',
      description: 'Type of validation to perform (json, regex, hallucination, or pii)',
    },
    regex: {
      type: 'string',
      description: 'Regex pattern for regex validation',
    },
    knowledgeBaseId: {
      type: 'string',
      description: 'Knowledge base ID for hallucination check',
    },
    threshold: {
      type: 'string',
      description: 'Confidence threshold (0-10 scale, default: 3, scores below fail)',
    },
    topK: {
      type: 'string',
      description: 'Number of chunks to retrieve from knowledge base (default: 5)',
    },
    model: {
      type: 'string',
      description: 'LLM model for hallucination scoring (default: gpt-4o-mini)',
    },
    apiKey: {
      type: 'string',
      description: 'API key for LLM provider (optional if using hosted)',
    },
    piiEntityTypes: {
      type: 'json',
      description: 'PII entity types to detect (array of strings, empty = detect all)',
    },
    piiMode: {
      type: 'string',
      description: 'PII action mode: block or mask',
    },
    piiLanguage: {
      type: 'string',
      description: 'Language for PII detection (default: en)',
    },
  },
  outputs: {
    input: {
      type: 'string',
      description: 'Original input that was validated',
    },
    maskedText: {
      type: 'string',
      description: 'Text with PII masked (only for PII detection in mask mode)',
    },
    validationType: {
      type: 'string',
      description: 'Type of validation performed',
    },
    passed: {
      type: 'boolean',
      description: 'Whether validation passed (true/false)',
    },
    score: {
      type: 'number',
      description:
        'Confidence score (0-10, 0=hallucination, 10=grounded, only for hallucination check)',
    },
    reasoning: {
      type: 'string',
      description: 'Reasoning for confidence score (only for hallucination check)',
    },
    detectedEntities: {
      type: 'array',
      description: 'Detected PII entities (only for PII detection)',
    },
    error: {
      type: 'string',
      description: 'Error message if validation failed',
    },
  },
}
