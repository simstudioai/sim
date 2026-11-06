import { HiggsfieldIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'

const GENERATE_OPERATIONS = ['higgsfield_generate', 'higgsfield_generate_soul_image']
const REQUEST_OPERATIONS = [
  'higgsfield_get_request_status',
  'higgsfield_cancel_request',
  'higgsfield_delete_request',
]
const CHARACTER_ID_OPERATIONS = ['higgsfield_get_character', 'higgsfield_delete_character']
const SOUL = 'higgsfield_generate_soul_image'

export const HiggsfieldBlock: BlockConfig = {
  type: 'higgsfield',
  name: 'Higgsfield',
  description: 'Generate images and videos with Higgsfield models',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate images and videos with any Higgsfield model, create SOUL images with styles and trained characters, train and manage Soul ID characters, and check, cancel, or delete generation requests.',
  docsLink: 'https://docs.sim.ai/integrations/higgsfield',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#D1FE17',
  icon: HiggsfieldIcon,
  canvasPresentation: {
    defaultTitle: 'Higgsfield',
    sentences: {
      byOperation: {
        higgsfield_generate: [
          { text: 'Generate with', field: 'model', core: true },
          { text: 'from', field: 'input' },
        ],
        higgsfield_generate_soul_image: [
          { text: 'Generate a SOUL image of', field: 'prompt', core: true },
          { text: 'as', field: 'characterId' },
        ],
        higgsfield_get_request_status: [
          { text: 'Check the status of', field: 'requestId', core: true },
        ],
        higgsfield_cancel_request: [{ text: 'Cancel', field: 'requestId', core: true }],
        higgsfield_delete_request: [{ text: 'Delete', field: 'requestId', core: true }],
        higgsfield_create_character: [
          { text: 'Train character', field: 'name', core: true },
          { text: 'from', field: 'imageUrls' },
        ],
        higgsfield_get_character: [{ text: 'Read', field: 'characterId', core: true }],
        higgsfield_list_characters: ['List Soul ID characters'],
        higgsfield_delete_character: [{ text: 'Delete', field: 'characterId', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Generate (Any Model)', id: 'higgsfield_generate' },
        { label: 'Generate SOUL Image', id: 'higgsfield_generate_soul_image' },
        { label: 'Get Request Status', id: 'higgsfield_get_request_status' },
        { label: 'Cancel Request', id: 'higgsfield_cancel_request' },
        { label: 'Delete Request', id: 'higgsfield_delete_request' },
        { label: 'Create Character', id: 'higgsfield_create_character' },
        { label: 'Get Character', id: 'higgsfield_get_character' },
        { label: 'List Characters', id: 'higgsfield_list_characters' },
        { label: 'Delete Character', id: 'higgsfield_delete_character' },
      ],
      value: () => 'higgsfield_generate_soul_image',
    },
    {
      id: 'credential',
      title: 'Higgsfield Account',
      type: 'oauth-input',
      serviceId: 'higgsfield',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Higgsfield credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Higgsfield Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'model',
      title: 'Model Endpoint',
      type: 'short-input',
      condition: { field: 'operation', value: 'higgsfield_generate' },
      placeholder: 'kling-video/v2.5-turbo/pro/text-to-video',
      required: true,
    },
    {
      id: 'input',
      title: 'Input',
      type: 'code',
      language: 'json',
      condition: { field: 'operation', value: 'higgsfield_generate' },
      placeholder: '{"prompt": "A drone shot over a misty forest at sunrise", "duration": 5}',
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate the JSON request body for a Higgsfield model endpoint, using only fields documented for that model. Return ONLY a JSON object.',
        placeholder: 'Describe the image or video to generate...',
        generationType: 'json-object',
      },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      condition: { field: 'operation', value: SOUL },
      placeholder: 'Describe the image to generate',
      required: true,
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      condition: { field: 'operation', value: SOUL },
      options: [
        { label: '4:3', id: '4:3' },
        { label: '3:4', id: '3:4' },
        { label: '1:1', id: '1:1' },
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '3:2', id: '3:2' },
        { label: '2:3', id: '2:3' },
      ],
      value: () => '4:3',
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      condition: { field: 'operation', value: SOUL },
      options: [
        { label: '720p', id: '720p' },
        { label: '1080p', id: '1080p' },
      ],
      value: () => '720p',
    },
    {
      id: 'batchSize',
      title: 'Number of Images',
      type: 'dropdown',
      condition: { field: 'operation', value: SOUL },
      options: [
        { label: '1', id: '1' },
        { label: '4', id: '4' },
      ],
      value: () => '1',
    },
    {
      id: 'characterId',
      title: 'Character ID',
      type: 'short-input',
      condition: { field: 'operation', value: [SOUL, ...CHARACTER_ID_OPERATIONS] },
      required: { field: 'operation', value: CHARACTER_ID_OPERATIONS },
      placeholder: 'Soul ID character reference ID',
      canvasNoun: 'a character',
    },
    {
      id: 'characterStrength',
      title: 'Character Strength',
      type: 'short-input',
      condition: { field: 'operation', value: SOUL },
      placeholder: '0 to 1 (defaults to 1)',
      mode: 'advanced',
    },
    {
      id: 'styleId',
      title: 'Style ID',
      type: 'short-input',
      condition: { field: 'operation', value: SOUL },
      placeholder: 'Defaults to the general style',
      mode: 'advanced',
    },
    {
      id: 'styleStrength',
      title: 'Style Strength',
      type: 'short-input',
      condition: { field: 'operation', value: SOUL },
      placeholder: '0 to 1 (defaults to 1)',
      mode: 'advanced',
    },
    {
      id: 'imageReferenceUrl',
      title: 'Image Reference URL',
      type: 'short-input',
      condition: { field: 'operation', value: SOUL },
      placeholder: 'https://example.com/reference.jpg',
      mode: 'advanced',
    },
    {
      id: 'enhancePrompt',
      title: 'Enhance Prompt',
      type: 'switch',
      condition: { field: 'operation', value: SOUL },
      defaultValue: false,
      mode: 'advanced',
    },
    {
      id: 'seed',
      title: 'Seed',
      type: 'short-input',
      condition: { field: 'operation', value: SOUL },
      placeholder: '1 to 1000000 (random when empty)',
      mode: 'advanced',
    },
    {
      id: 'waitForCompletion',
      title: 'Wait for Result',
      type: 'switch',
      condition: { field: 'operation', value: GENERATE_OPERATIONS },
      defaultValue: true,
    },
    {
      id: 'webhookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      condition: { field: 'operation', value: GENERATE_OPERATIONS },
      placeholder: 'https://example.com/higgsfield-webhook',
      mode: 'advanced',
    },
    {
      id: 'idempotencyKey',
      title: 'Idempotency Key',
      type: 'short-input',
      condition: { field: 'operation', value: GENERATE_OPERATIONS },
      placeholder: 'Unique key, such as a UUID',
      mode: 'advanced',
    },
    {
      id: 'expiresAfter',
      title: 'Keep Data For (Seconds)',
      type: 'short-input',
      condition: { field: 'operation', value: GENERATE_OPERATIONS },
      placeholder: 'At least 3600 (defaults to the account retention)',
      mode: 'advanced',
    },
    {
      id: 'requestId',
      title: 'Request ID',
      type: 'short-input',
      condition: { field: 'operation', value: REQUEST_OPERATIONS },
      placeholder: 'Higgsfield request ID',
      required: true,
      canvasNoun: 'a request',
    },
    {
      id: 'name',
      title: 'Character Name',
      type: 'short-input',
      condition: { field: 'operation', value: 'higgsfield_create_character' },
      placeholder: 'Enter a name (up to 100 characters)',
      required: true,
    },
    {
      id: 'modelVersion',
      title: 'SOUL Version',
      type: 'dropdown',
      condition: { field: 'operation', value: 'higgsfield_create_character' },
      options: [
        { label: 'SOUL (v1)', id: 'v1' },
        { label: 'SOUL V2', id: 'v2' },
        { label: 'SOUL Cinema', id: 'cinema' },
      ],
      value: () => 'v1',
    },
    {
      id: 'imageUrls',
      title: 'Training Image URLs',
      type: 'long-input',
      condition: { field: 'operation', value: 'higgsfield_create_character' },
      placeholder: 'One public image URL per line (1 to 100)',
      required: true,
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      condition: { field: 'operation', value: 'higgsfield_list_characters' },
      placeholder: 'Defaults to 1',
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      condition: { field: 'operation', value: 'higgsfield_list_characters' },
      placeholder: 'Defaults to 20',
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'higgsfield_generate',
      'higgsfield_generate_soul_image',
      'higgsfield_get_request_status',
      'higgsfield_cancel_request',
      'higgsfield_delete_request',
      'higgsfield_create_character',
      'higgsfield_get_character',
      'higgsfield_list_characters',
      'higgsfield_delete_character',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params, context) => {
        const operation = context?.operation ?? params.operation
        const isSoul = operation === SOUL
        const isGenerate = GENERATE_OPERATIONS.includes(operation)
        const isList = operation === 'higgsfield_list_characters'
        return {
          ...params,
          batchSize: isSoul
            ? parseOptionalNumberInput(params.batchSize, 'Number of Images', { integer: true })
            : undefined,
          characterStrength: isSoul
            ? parseOptionalNumberInput(params.characterStrength, 'Character Strength', {
                min: 0,
                max: 1,
              })
            : undefined,
          styleStrength: isSoul
            ? parseOptionalNumberInput(params.styleStrength, 'Style Strength', { min: 0, max: 1 })
            : undefined,
          seed: isSoul
            ? parseOptionalNumberInput(params.seed, 'Seed', { integer: true, min: 1, max: 1000000 })
            : undefined,
          expiresAfter: isGenerate
            ? parseOptionalNumberInput(params.expiresAfter, 'Keep Data For', {
                integer: true,
                min: 3600,
              })
            : undefined,
          page: isList
            ? parseOptionalNumberInput(params.page, 'Page', { integer: true, min: 1 })
            : undefined,
          pageSize: isList
            ? parseOptionalNumberInput(params.pageSize, 'Page Size', { integer: true, min: 1 })
            : undefined,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Saved Higgsfield API-key credential ID' },
    model: { type: 'string', description: 'Model endpoint ID' },
    input: { type: 'json', description: 'Model request body' },
    prompt: { type: 'string', description: 'Image prompt' },
    aspectRatio: { type: 'string', description: 'Aspect ratio' },
    resolution: { type: 'string', description: 'Resolution' },
    batchSize: { type: 'number', description: 'Number of images' },
    characterId: { type: 'string', description: 'Soul ID character reference ID' },
    characterStrength: { type: 'number', description: 'Character strength' },
    styleId: { type: 'string', description: 'SOUL style ID' },
    styleStrength: { type: 'number', description: 'Style strength' },
    imageReferenceUrl: { type: 'string', description: 'Image reference URL' },
    enhancePrompt: { type: 'boolean', description: 'Enhance prompt' },
    seed: { type: 'number', description: 'Seed' },
    waitForCompletion: { type: 'boolean', description: 'Wait for the result' },
    webhookUrl: { type: 'string', description: 'Completion webhook URL' },
    idempotencyKey: { type: 'string', description: 'Idempotency key' },
    expiresAfter: { type: 'number', description: 'Seconds to keep request data' },
    requestId: { type: 'string', description: 'Request ID' },
    name: { type: 'string', description: 'Character name' },
    modelVersion: { type: 'string', description: 'SOUL version for the character' },
    imageUrls: { type: 'json', description: 'Training image URLs' },
    page: { type: 'number', description: 'Page number' },
    pageSize: { type: 'number', description: 'Page size' },
  },
  outputs: {
    requestId: { type: 'string', description: 'Higgsfield request ID' },
    status: { type: 'string', description: 'Request status' },
    error: { type: 'string', description: 'Failure reason, when provided' },
    imageUrls: { type: 'array', description: 'Generated image URLs' },
    videoUrl: { type: 'string', description: 'Generated video URL' },
    audioUrl: { type: 'string', description: 'Generated audio URL' },
    audioUrls: { type: 'array', description: 'Generated audio URLs' },
    statusUrl: { type: 'string', description: 'Request status URL' },
    cancelUrl: { type: 'string', description: 'Request cancel URL' },
    expiresAt: { type: 'string', description: 'When the output URLs stop working' },
    canceled: { type: 'boolean', description: 'Whether the request was canceled' },
    deleted: { type: 'boolean', description: 'Whether the request or character was deleted' },
    character: {
      type: 'json',
      description:
        'Character (id, name, modelVersion, status, thumbnailUrl, createdAt, inProgressAt, failReason)',
    },
    characters: {
      type: 'array',
      description:
        'Characters on this page (id, name, modelVersion, status, thumbnailUrl, createdAt, inProgressAt, failReason)',
    },
    characterId: { type: 'string', description: 'ID of the deleted character' },
    total: { type: 'number', description: 'Total number of characters' },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Characters per page' },
    totalPages: { type: 'number', description: 'Total number of pages' },
  },
}

export const HiggsfieldBlockMeta = {
  tags: ['image-generation', 'video-generation', 'marketing', 'automation'],
  url: 'https://higgsfield.ai',
  templates: [
    {
      icon: HiggsfieldIcon,
      title: 'Higgsfield product video batch',
      prompt:
        'Build a workflow that reads product names, descriptions, and image URLs from a Sim table, writes a short video prompt for each product with an agent, generates an image-to-video clip with a Higgsfield video model, and saves each video URL and request ID back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'automation'],
      featured: true,
    },
    {
      icon: HiggsfieldIcon,
      title: 'Higgsfield brand character images',
      prompt:
        'Create a workflow that takes a campaign brief, writes SOUL image prompts for each scene with an agent, generates images with Higgsfield SOUL using our trained Soul ID character, and collects the image URLs for review.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'branding'],
    },
    {
      icon: HiggsfieldIcon,
      title: 'Higgsfield character training',
      prompt:
        'Build a workflow that creates a Higgsfield Soul ID character from a list of reference photo URLs, checks the character every few minutes until training completes or fails, and posts the character ID or failure reason to Slack.',
      modules: ['workflows'],
      category: 'marketing',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HiggsfieldIcon,
      title: 'Higgsfield social clip from a post',
      prompt:
        'Create a workflow that takes a blog post URL, summarizes it into a 5-second visual hook with an agent, generates a vertical text-to-video clip with a Higgsfield video model, and returns the video URL with a suggested caption.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'social'],
    },
    {
      icon: HiggsfieldIcon,
      title: 'Higgsfield output archiver',
      prompt:
        'Build a scheduled workflow that reads Higgsfield request IDs from a Sim table, gets each request status, downloads completed images and videos into workspace files before their URLs expire, records the file links, and deletes the request data from Higgsfield.',
      modules: ['scheduled', 'tables', 'files', 'workflows'],
      category: 'operations',
      tags: ['storage', 'automation'],
    },
    {
      icon: HiggsfieldIcon,
      title: 'Higgsfield ad creative variants',
      prompt:
        'Create a workflow that takes one product ad brief, writes four distinct visual concepts with an agent, generates four SOUL images for each concept in 9:16, and saves every image URL with its concept to a Sim table for review.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['advertising', 'content'],
    },
    {
      icon: HiggsfieldIcon,
      title: 'Higgsfield generation queue',
      prompt:
        'Build a workflow that submits Higgsfield video requests from a Sim table without waiting, stores each request ID, and on a schedule checks pending requests, writes finished video URLs or failure reasons back, and cancels requests still queued after an hour.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'generate-higgsfield-media',
      description:
        "Generate an image or video with a Higgsfield model using that model's documented input fields.",
      content:
        '# Generate Higgsfield Media\n\nCreate images or videos with the right Higgsfield model and inputs.\n\n## Steps\n1. Choose the model endpoint ID from the Higgsfield model catalog (for example a text-to-video or image-to-video workflow).\n2. Build the JSON input using only the fields documented for that endpoint; image and video references must be public URLs.\n3. Use Generate SOUL Image for SOUL stills, styles, and trained characters; use Generate (Any Model) for every other model.\n4. Wait for the result, or return immediately and check later with Get Request Status for long video jobs.\n5. Treat failed and nsfw statuses as final and report the reason.\n\n## Output\nThe request ID, final status, and image, video, or audio URLs.\n\nReference: https://docs.higgsfield.ai/docs/how-to/introduction',
    },
    {
      name: 'train-higgsfield-soul-id-character',
      description: 'Train a reusable Soul ID character and use it for consistent SOUL images.',
      content:
        '# Train a Higgsfield Soul ID Character\n\nKeep the same person or mascot consistent across generated images.\n\n## Steps\n1. Collect 1 to 100 public URLs of clear reference photos with varied angles and lighting.\n2. Create the character with SOUL version v1, the version Generate SOUL Image accepts.\n3. Check the character with Get Character until its status is completed or failed.\n4. Pass the completed character ID to Generate SOUL Image; adjust character strength if the likeness is too weak or too strong.\n5. Delete characters that are no longer needed.\n\n## Output\nThe character ID and status, plus any generated image URLs.\n\nReference: https://docs.higgsfield.ai/docs/models/soul-id/create-character',
    },
    {
      name: 'manage-higgsfield-requests',
      description:
        'Track, cancel, and clean up Higgsfield generation requests and keep their outputs before they expire.',
      content:
        "# Manage Higgsfield Requests\n\nRun long generations asynchronously without losing results.\n\n## Steps\n1. Store every request ID as soon as a generation is submitted.\n2. Check pending requests with Get Request Status; statuses are queued, in_progress, completed, failed, nsfw, and canceled.\n3. Cancel a request only while it is still queued.\n4. Copy completed media to your own storage before expiresAt, since request data is kept for seven days by default.\n5. Delete finished requests whose data should not be retained.\n\n## Output\nEach request's final status and the stored output locations.\n\nReference: https://docs.higgsfield.ai/docs/concepts/requests",
    },
  ],
} as const satisfies BlockMeta
