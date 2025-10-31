import { ReplicateIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ReplicateResponse } from '@/tools/replicate/types'

export const ReplicateBlock: BlockConfig<ReplicateResponse> = {
  type: 'replicate',
  name: 'Replicate',
  description: 'Run AI models on Replicate',
  longDescription:
    'Run thousands of AI models using Replicate\'s unified prediction API. Supports text-to-image, image-to-image, text generation, and many more model types. A Replicate API Token is required to fetch model info and generate.',
  authMode: AuthMode.ApiKey,
  docsLink: 'https://docs.sim.ai/tools/replicate',
  category: 'tools',
  bgColor: '#000000', // Replicate black
  icon: ReplicateIcon,
  bestPractices: `
- Use sync mode for quick models (text generation, classification) - default
- Use async mode for long-running models (image generation, video, etc.)
- The webhook payload in async is sent when the entire prediction is "completed"
- Provide model in owner/name format (e.g., black-forest-labs/flux-schnell)
- For official models, use just owner/name (version auto-selected)
- For community models, specify version for reproducibility
- Check model documentation on replicate.com for required inputs
  `.trim(),
  subBlocks: [
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      layout: 'full',
      password: true,
      required: true,
      placeholder: 'r8_... or {{REPLICATE_API_TOKEN}}',
      description: 'Your Replicate API token or environment variable',
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      layout: 'full',
      hidden: true, // Hidden - only for state storage, UI rendered in openapi-dynamic-inputs
    },
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      layout: 'full',
      required: true,
      hidden: true, // Hidden - model selector in openapi-dynamic-inputs handles UI
      condition: {
        field: 'apiKey',
        value: '',
        not: true,
      },
    },
    {
      id: 'version',
      title: 'Version (Optional)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Leave empty for latest version',
      description: 'Specify exact version for reproducibility. Leave empty to use latest_version.',
      condition: {
        field: 'collection',
        value: ['none', ''],
      },
    },
    {
      id: 'modelInputs',
      title: 'Model Parameters',
      type: 'openapi-dynamic-inputs',
      layout: 'full',
      description: 'Select a Replicate model and configure its parameters. Browse by collection or enter directly in owner/model-name format.',
      condition: {
        field: 'apiKey',
        value: '',
        not: true,
      },
      props: {
        modelSelector: {
          enabled: true,
          provider: 'replicate',
          enableCollections: true,
          collectionsEndpoint: '/api/replicate/collections',
          collectionModelsEndpoint: '/api/replicate/collections',
          apiKeySubBlockId: 'apiKey',
          modelSubBlockId: 'model',
          collectionSubBlockId: 'collection',
          apiKeyHeaderName: 'x-replicate-api-key',
        },
        schemaFetching: {
          enabled: true,
          endpoint: '/api/replicate/models',
          apiKeySubBlockId: 'apiKey',
          versionSubBlockId: 'version',
          modelSubBlockId: 'model',
          apiKeyHeaderName: 'x-replicate-api-key',
        },
        groupFields: true,
        preferLongInput: true,
        showDescriptions: true,
      },
    },
    {
      id: 'mode',
      title: 'Execution Mode',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Sync', id: 'sync' },
        { label: 'Async', id: 'async' },
      ],
      value: () => 'sync',
      description: 'Sync waits (1-60s) for prediction output. Async returns ID and urls immediately with the webhook notified when completed.',
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'slider',
      layout: 'half',
      min: 1,
      max: 60,
      value: () => '60',
      condition: { field: 'mode', value: 'sync' },
      description: 'Max time to wait for sync predictions (Replicate limit: 60 seconds)',
    },
    {
      id: 'webhook',
      title: 'Webhook URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g. https://www.sim.ai/api/webhooks/trigger/example',
      condition: { field: 'mode', value: 'async' },
      description: 'Optional: Webhook URL to notify when the prediction completes. Leave empty if no notification needed.',
    },
  ],
  tools: {
    access: ['replicate_create_prediction'],
    config: {
      tool: () => 'replicate_create_prediction',
      params: (params) => ({
        apiKey: params.apiKey,
        model: params.model,
        version: params.version,
        input: params.modelInputs,
        mode: params.mode,
        timeout: params.timeout,
        webhook: params.webhook,
      }),
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'Replicate API token' },
    model: { type: 'string', description: 'Model identifier (owner/name or owner/name:version)' },
    version: { type: 'string', description: 'Model version (optional)' },
    modelInputs: { type: 'json', description: 'Model input parameters per model schema' },
    mode: { type: 'string', description: 'Execution mode (async or sync)' },
    timeout: { type: 'string', description: 'Timeout 1-60 seconds for sync mode' },
    webhook: { type: 'string', description: 'Webhook URL for async completion notifications' },
  },
  outputs: {
    id: { type: 'string', description: 'Replicate Prediction ID' },
    status: { type: 'string', description: 'Prediction status (starting, processing, succeeded, failed, canceled)' },
    output: { type: 'json', description: 'Prediction output (available when status is succeeded)' },
    error: { type: 'string', description: 'Error message if prediction failed' },
    urls: { type: 'json', description: 'URLs for managing prediction outputs' },
    'urls.get': { type: 'string', description: 'URL to download result from API' },
  },
}
