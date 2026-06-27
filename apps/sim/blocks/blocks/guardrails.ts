import { PII_ENTITY_GROUPS, PII_LANGUAGES } from '@/lib/guardrails/pii-entities'
import { GuardrailsBlockDisplay } from '@/blocks/blocks/guardrails.display'
import type { BlockConfig } from '@/blocks/types'
import {
  getModelOptions,
  getProviderCredentialSubBlocks,
  PROVIDER_CREDENTIAL_INPUTS,
} from '@/blocks/utils'
import type { ToolResponse } from '@/tools/types'

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
  ...GuardrailsBlockDisplay,
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
  subBlocks: [
    {
      id: 'input',
      title: 'Content to Validate',
      type: 'long-input',
      placeholder: 'Enter content to validate',
      required: true,
    },
    {
      id: 'validationType',
      title: 'Validation Type',
      type: 'dropdown',
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
      placeholder: 'e.g., ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
      required: true,
      condition: {
        field: 'validationType',
        value: ['regex'],
      },
      dependsOn: ['validationType'],
      wandConfig: {
        enabled: true,
        prompt: `Generate a regular expression pattern based on the user's description.
The regex should be:
- Valid JavaScript regex syntax
- Properly escaped for special characters
- Optimized for the use case

Common patterns:
- Email: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$
- Phone (US): ^\\+?1?[-.\\s]?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}$
- URL: ^https?:\\/\\/[\\w\\-]+(\\.[\\w\\-]+)+[/#?]?.*$
- Date (YYYY-MM-DD): ^\\d{4}-\\d{2}-\\d{2}$
- UUID: ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
- IP Address: ^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$

Examples:
- "validate email" -> ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$
- "check for numbers only" -> ^\\d+$
- "alphanumeric with underscores" -> ^[a-zA-Z0-9_]+$

Return ONLY the regex pattern - no explanations, no quotes, no forward slashes, no extra text.`,
        placeholder: 'Describe the pattern you want to match...',
      },
    },
    {
      id: 'knowledgeBaseId',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      placeholder: 'Select knowledge base',
      multiSelect: false,
      required: true,
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
      dependsOn: ['validationType'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
      required: true,
      options: getModelOptions,
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
      dependsOn: ['validationType'],
    },
    {
      id: 'threshold',
      title: 'Confidence',
      type: 'slider',
      min: 0,
      max: 10,
      step: 1,
      defaultValue: 3,
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
      dependsOn: ['validationType'],
    },
    {
      id: 'topK',
      title: 'Number of Chunks to Retrieve',
      type: 'slider',
      min: 1,
      max: 20,
      step: 1,
      defaultValue: 5,
      mode: 'advanced',
      condition: {
        field: 'validationType',
        value: ['hallucination'],
      },
      dependsOn: ['validationType'],
    },
    // Provider credential subblocks - only shown for hallucination validation
    ...getProviderCredentialSubBlocks().map((subBlock) => ({
      ...subBlock,
      // Combine with hallucination condition
      condition: subBlock.condition
        ? {
            field: 'validationType' as const,
            value: ['hallucination'],
            and:
              typeof subBlock.condition === 'function' ? subBlock.condition() : subBlock.condition,
          }
        : { field: 'validationType' as const, value: ['hallucination'] },
      dependsOn: ['validationType'],
    })),
    {
      id: 'piiEntityTypes',
      title: 'PII Types to Detect',
      type: 'grouped-checkbox-list',
      maxHeight: 400,
      // Driven by the shared catalog (includes VIN and custom recognizers) so the
      // block and the Data Retention settings never drift.
      options: PII_ENTITY_GROUPS.flatMap((group) =>
        group.entities.map((entity) => ({
          label: entity.label,
          id: entity.value,
          group: group.label,
        }))
      ),
      condition: {
        field: 'validationType',
        value: ['pii'],
      },
      dependsOn: ['validationType'],
    },
    {
      id: 'piiMode',
      title: 'Action',
      type: 'dropdown',
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
      dependsOn: ['validationType'],
    },
    {
      id: 'piiLanguage',
      title: 'Language',
      type: 'dropdown',
      options: PII_LANGUAGES.map((language) => ({ label: language.label, id: language.value })),
      defaultValue: 'en',
      condition: {
        field: 'validationType',
        value: ['pii'],
      },
      dependsOn: ['validationType'],
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
    ...PROVIDER_CREDENTIAL_INPUTS,
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
