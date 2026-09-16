/**
 * CLI-only labels, hints, prompts, and actions for runtime deployment capabilities.
 * Provider IDs and environment fields are checked against the application catalog at load time.
 *
 * @packageDocumentation
 */
import {
  ASYNC_JOBS_CAPABILITY,
  CACHE_CAPABILITY,
  type CapabilityDefinition,
  EMAIL_CAPABILITY,
  ENV_CAPABILITIES,
  type EnvCapabilityValues,
  getCapabilityFields,
  hasEnvCapabilityValue,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  OAUTH_CLIENT_CAPABILITIES,
  type OAuthClientCapabilityField,
  type OAuthClientCapabilityId,
  OCR_CAPABILITY,
  SANDBOX_CAPABILITY,
  STORAGE_CAPABILITY,
} from '@sim/deployment-config/env-capabilities'

export type SetupHint =
  | string
  | {
      development: string
      containerized: string
    }

export type SetupCondition =
  | { kind: 'present'; key: string }
  | { kind: 'truthy'; key: string }
  | { kind: 'equals'; key: string; value: string }
  | { kind: 'all'; conditions: readonly SetupCondition[] }
  | { kind: 'any'; conditions: readonly SetupCondition[] }
  | { kind: 'not'; condition: SetupCondition }

export type SetupPromptCondition = SetupCondition | { kind: 'provider-missing-field'; key: string }

export interface SetupFieldPrompt {
  type: 'field'
  key: string
  input: 'text' | 'secret'
  message?: string
  hint?: string
  required?: boolean
  defaultValue?: string
  validate?: boolean
  when?: SetupPromptCondition
}

export interface SetupConfirmPrompt {
  type: 'confirm'
  key: string
  message: string
  defaultValue?: boolean
  when?: SetupPromptCondition
}

export interface SetupChoiceOption {
  id: string
  label: string
  hint?: string
  currentWhen?: SetupCondition
  env?: Readonly<Record<string, string>>
  prompts?: readonly SetupPrompt[]
}

export interface SetupChoicePrompt {
  type: 'choice'
  id: string
  message: string
  options: readonly SetupChoiceOption[]
  when?: SetupPromptCondition
}

export type SetupPrompt = SetupFieldPrompt | SetupConfirmPrompt | SetupChoicePrompt

type ProviderId<TDefinition extends CapabilityDefinition> = TDefinition['providers'][number]['id']

export interface ProviderSetupDefinition {
  hint?: SetupHint
  env?: Readonly<Record<string, string>>
  prompts: readonly SetupPrompt[]
  currentWhen?: SetupCondition
}

type ProviderSetupMap<TDefinition extends CapabilityDefinition> = {
  [TId in ProviderId<TDefinition>]: ProviderSetupDefinition
}

export interface SetupActionDefinition {
  label: string
  hint?: SetupHint
  env?: Readonly<Record<string, string>>
  currentWhen?: SetupCondition
}

type DefaultOptionId<TDefinition extends CapabilityDefinition> = TDefinition extends {
  defaultProvider: { kind: 'built-in'; id: infer TId extends string }
}
  ? TId
  : never

export interface CapabilitySetupDefinition<
  TDefinition extends CapabilityDefinition = CapabilityDefinition,
  TActions extends Readonly<Record<string, SetupActionDefinition>> = Readonly<
    Record<string, SetupActionDefinition>
  >,
> {
  definition: TDefinition
  label: string
  message: string
  providers: ProviderSetupMap<TDefinition>
  actions: TActions
  defaultOption?: { hint?: SetupHint }
  optionOrder: readonly (ProviderId<TDefinition> | DefaultOptionId<TDefinition> | keyof TActions)[]
}

function promptKeys(prompts: readonly SetupPrompt[] = []): string[] {
  return prompts.flatMap((prompt) => {
    if (prompt.type === 'field' || prompt.type === 'confirm') return [prompt.key]
    return prompt.options.flatMap((option) => [
      ...Object.keys(option.env ?? {}),
      ...promptKeys(option.prompts),
    ])
  })
}

function conditionKeys(condition: SetupPromptCondition | undefined): string[] {
  if (!condition) return []
  if (
    condition.kind === 'present' ||
    condition.kind === 'truthy' ||
    condition.kind === 'equals' ||
    condition.kind === 'provider-missing-field'
  ) {
    return [condition.key]
  }
  if (condition.kind === 'all' || condition.kind === 'any') {
    return condition.conditions.flatMap(conditionKeys)
  }
  return conditionKeys(condition.condition)
}

function promptConditionKeys(prompts: readonly SetupPrompt[] = []): string[] {
  return prompts.flatMap((prompt) => [
    ...conditionKeys(prompt.when),
    ...(prompt.type === 'choice'
      ? prompt.options.flatMap((option) => [
          ...conditionKeys(option.currentWhen),
          ...promptConditionKeys(option.prompts),
        ])
      : []),
  ])
}

function requirementKeys(
  requirement: CapabilityDefinition['providers'][number]['requires']
): string[] {
  return requirement.type === 'field'
    ? [requirement.key]
    : requirement.requirements.flatMap(requirementKeys)
}

function providerOwnedInputKeys(
  provider: CapabilityDefinition['providers'][number]
): readonly string[] {
  return [
    ...requirementKeys(provider.requires),
    ...(provider.optionalFields ?? []).map((field) => field.key),
    ...(provider.pairedFields ?? []).flat(),
  ]
}

function providerOwnedSetupKeys(
  provider: CapabilityDefinition['providers'][number]
): readonly string[] {
  return [
    ...providerOwnedInputKeys(provider),
    ...(provider.activation.mode === 'enabled'
      ? [provider.activation.key]
      : provider.activation.keys),
  ]
}

export function defineCapabilitySetup<
  const TDefinition extends CapabilityDefinition,
  const TActions extends Readonly<Record<string, SetupActionDefinition>>,
>(
  definition: TDefinition,
  setup: Omit<CapabilitySetupDefinition<TDefinition, TActions>, 'definition'>
): CapabilitySetupDefinition<TDefinition, TActions> {
  const providerIds = definition.providers.map((provider) => provider.id)
  const configuredProviderIds = Object.keys(setup.providers)
  const missingProviders = providerIds.filter((id) => !configuredProviderIds.includes(id))
  const unknownProviders = configuredProviderIds.filter((id) => !providerIds.includes(id))
  if (missingProviders.length > 0 || unknownProviders.length > 0) {
    throw new Error(
      `Setup ${definition.id} provider mapping drifted (missing: ${missingProviders.join(', ') || 'none'}; unknown: ${unknownProviders.join(', ') || 'none'})`
    )
  }

  for (const provider of definition.providers) {
    const providerSetup = (setup.providers as Record<string, ProviderSetupDefinition>)[provider.id]
    if (!providerSetup) throw new Error(`Setup ${definition.id} has no provider ${provider.id}`)
    const ownedFields = providerOwnedInputKeys(provider)
    const setupFields = providerOwnedSetupKeys(provider)
    const configuredFields = [
      ...promptKeys(providerSetup.prompts),
      ...Object.keys(providerSetup.env ?? {}),
    ]
    const referencedFields = [
      ...configuredFields,
      ...conditionKeys(providerSetup.currentWhen),
      ...promptConditionKeys(providerSetup.prompts),
    ]
    const unknownFields = referencedFields.filter((key) => !setupFields.includes(key))
    const missingFields = ownedFields.filter((key) => !configuredFields.includes(key))
    if (unknownFields.length > 0 || missingFields.length > 0) {
      throw new Error(
        `Setup ${definition.id}/${provider.id} field mapping drifted (missing: ${missingFields.join(', ') || 'none'}; unknown: ${unknownFields.join(', ') || 'none'})`
      )
    }
  }

  const capabilityFields = getCapabilityFields(definition)
  for (const [actionId, action] of Object.entries(setup.actions)) {
    const unknownFields = [
      ...Object.keys(action.env ?? {}),
      ...conditionKeys(action.currentWhen),
    ].filter((key) => !capabilityFields.includes(key))
    if (unknownFields.length > 0) {
      throw new Error(
        `Setup ${definition.id}/${actionId} action writes unknown fields: ${unknownFields.join(', ')}`
      )
    }
  }

  const optionIds = [
    ...providerIds,
    ...Object.keys(setup.actions),
    ...(definition.strategy === 'selected' && definition.defaultProvider.kind === 'built-in'
      ? [definition.defaultProvider.id]
      : []),
  ]
  if (
    setup.optionOrder.length !== optionIds.length ||
    setup.optionOrder.some((id) => !optionIds.includes(String(id))) ||
    optionIds.some((id) => !setup.optionOrder.includes(id))
  ) {
    throw new Error(`Setup ${definition.id} option order must list every option once`)
  }

  return { definition, ...setup }
}

export const EMAIL_SETUP = defineCapabilitySetup(EMAIL_CAPABILITY, {
  label: 'Email delivery',
  message: 'Email sending?',
  actions: {
    none: {
      label: 'None',
      hint: 'emails are logged to the console — fine for local',
    },
  },
  providers: {
    resend: {
      hint: 'paste an API key',
      prompts: [
        {
          type: 'field',
          key: 'RESEND_API_KEY',
          input: 'secret',
          required: true,
        },
      ],
    },
    ses: {
      hint: 'uses the AWS SDK credential chain',
      prompts: [
        {
          type: 'field',
          key: 'AWS_SES_REGION',
          input: 'text',
          required: true,
          defaultValue: 'us-east-1',
        },
      ],
    },
    smtp: {
      hint: 'any SMTP relay',
      prompts: [
        { type: 'field', key: 'SMTP_HOST', input: 'text', required: true },
        {
          type: 'field',
          key: 'SMTP_PORT',
          input: 'text',
          required: true,
          defaultValue: '587',
          validate: true,
        },
        {
          type: 'field',
          key: 'SMTP_USER',
          input: 'text',
          hint: 'leave empty for an unauthenticated relay',
        },
        {
          type: 'field',
          key: 'SMTP_PASS',
          input: 'secret',
          required: true,
          when: { kind: 'present', key: 'SMTP_USER' },
        },
      ],
    },
    azure: {
      hint: 'connection string',
      prompts: [
        {
          type: 'field',
          key: 'AZURE_ACS_CONNECTION_STRING',
          input: 'secret',
          required: true,
        },
      ],
    },
    gmail: {
      hint: 'Workspace service account delegation',
      prompts: [
        {
          type: 'field',
          key: 'GMAIL_CREDENTIALS_JSON',
          input: 'secret',
          required: true,
          validate: true,
        },
        { type: 'field', key: 'GMAIL_SENDER', input: 'text', required: true },
      ],
    },
  },
  optionOrder: ['none', 'resend', 'ses', 'smtp', 'azure', 'gmail'],
})

export const STORAGE_SETUP = defineCapabilitySetup(STORAGE_CAPABILITY, {
  label: 'File storage',
  message: 'File storage?',
  actions: {},
  defaultOption: {
    hint: {
      development:
        'fine for local dev (external-fetch flows like Instagram publish need cloud storage)',
      containerized: 'files live in the container — LOST on restart; evaluation only',
    },
  },
  providers: {
    azure: {
      hint: 'connection string or account name + key',
      prompts: [
        {
          type: 'field',
          key: 'AZURE_STORAGE_CONTAINER_NAME',
          input: 'text',
          required: true,
          defaultValue: 'sim-files',
        },
        {
          type: 'choice',
          id: 'azure-credentials',
          message: 'Azure credentials?',
          options: [
            {
              id: 'connection-string',
              label: 'Connection string',
              currentWhen: { kind: 'present', key: 'AZURE_CONNECTION_STRING' },
              prompts: [
                {
                  type: 'field',
                  key: 'AZURE_CONNECTION_STRING',
                  input: 'secret',
                  required: true,
                },
              ],
            },
            {
              id: 'account-key',
              label: 'Account name and key',
              currentWhen: {
                kind: 'any',
                conditions: [
                  { kind: 'present', key: 'AZURE_ACCOUNT_NAME' },
                  { kind: 'present', key: 'AZURE_ACCOUNT_KEY' },
                ],
              },
              prompts: [
                {
                  type: 'field',
                  key: 'AZURE_ACCOUNT_NAME',
                  input: 'text',
                  required: true,
                },
                {
                  type: 'field',
                  key: 'AZURE_ACCOUNT_KEY',
                  input: 'secret',
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    },
    s3: {
      hint: 'AWS S3 or an S3-compatible endpoint',
      env: { S3_FORCE_PATH_STYLE: 'false' },
      prompts: [
        {
          type: 'field',
          key: 'S3_ENDPOINT',
          input: 'text',
          hint: 'optional for R2, MinIO, B2, or another S3-compatible service',
          validate: true,
        },
        {
          type: 'confirm',
          key: 'S3_FORCE_PATH_STYLE',
          message: 'Force path-style addressing? (required for MinIO/Ceph, not for R2)',
          when: { kind: 'present', key: 'S3_ENDPOINT' },
        },
        { type: 'field', key: 'AWS_REGION', input: 'text', required: true },
        { type: 'field', key: 'S3_BUCKET_NAME', input: 'text', required: true },
        {
          type: 'choice',
          id: 'aws-credentials',
          message: 'AWS credentials?',
          options: [
            {
              id: 'chain',
              label: 'Default credential chain',
              hint: 'IAM role, IRSA, profile, or other SDK source',
              currentWhen: {
                kind: 'all',
                conditions: [
                  { kind: 'present', key: 'S3_BUCKET_NAME' },
                  {
                    kind: 'not',
                    condition: {
                      kind: 'any',
                      conditions: [
                        { kind: 'present', key: 'AWS_ACCESS_KEY_ID' },
                        { kind: 'present', key: 'AWS_SECRET_ACCESS_KEY' },
                      ],
                    },
                  },
                ],
              },
            },
            {
              id: 'static',
              label: 'Access key and secret',
              hint: 'stored in AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY',
              currentWhen: {
                kind: 'any',
                conditions: [
                  { kind: 'present', key: 'AWS_ACCESS_KEY_ID' },
                  { kind: 'present', key: 'AWS_SECRET_ACCESS_KEY' },
                ],
              },
              prompts: [
                {
                  type: 'field',
                  key: 'AWS_ACCESS_KEY_ID',
                  input: 'secret',
                  required: true,
                },
                {
                  type: 'field',
                  key: 'AWS_SECRET_ACCESS_KEY',
                  input: 'secret',
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    },
    gcs: {
      hint: 'bucket; credentials via ADC by default',
      prompts: [
        {
          type: 'field',
          key: 'GCS_BUCKET_NAME',
          input: 'text',
          required: true,
        },
        {
          type: 'field',
          key: 'GCS_PROJECT_ID',
          input: 'text',
          hint: 'optional; inferred from credentials or ADC when empty',
        },
        {
          type: 'choice',
          id: 'gcs-credentials',
          message: 'Google Cloud credentials?',
          options: [
            {
              id: 'adc',
              label: 'Application Default Credentials',
              hint: 'Workload Identity or GOOGLE_APPLICATION_CREDENTIALS',
              currentWhen: {
                kind: 'all',
                conditions: [
                  { kind: 'present', key: 'GCS_BUCKET_NAME' },
                  {
                    kind: 'not',
                    condition: { kind: 'present', key: 'GCS_CREDENTIALS_JSON' },
                  },
                ],
              },
            },
            {
              id: 'json',
              label: 'Inline service account JSON',
              hint: 'stored in GCS_CREDENTIALS_JSON',
              currentWhen: { kind: 'present', key: 'GCS_CREDENTIALS_JSON' },
              prompts: [
                {
                  type: 'field',
                  key: 'GCS_CREDENTIALS_JSON',
                  input: 'secret',
                  required: true,
                  validate: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  optionOrder: ['local', 's3', 'azure', 'gcs'],
})

export const SANDBOX_SETUP = defineCapabilitySetup(SANDBOX_CAPABILITY, {
  label: 'Function sandboxes',
  message: 'Function sandbox provider?',
  actions: {
    disabled: {
      label: 'Disabled',
      hint: 'local JavaScript execution only',
      env: {
        NEXT_PUBLIC_E2B_ENABLED: 'false',
        NEXT_PUBLIC_SANDBOXES_ENABLED: 'false',
      },
      currentWhen: {
        kind: 'all',
        conditions: [
          { kind: 'not', condition: { kind: 'truthy', key: 'E2B_ENABLED' } },
          {
            kind: 'not',
            condition: { kind: 'present', key: 'DAYTONA_API_KEY' },
          },
          {
            kind: 'not',
            condition: { kind: 'present', key: 'DAYTONA_FUNCTION_SNAPSHOT_ID' },
          },
        ],
      },
    },
  },
  providers: {
    e2b: {
      hint: 'dedicated Function code and CLI sandboxes',
      env: {
        NEXT_PUBLIC_E2B_ENABLED: 'true',
        NEXT_PUBLIC_SANDBOXES_ENABLED: 'true',
      },
      prompts: [
        { type: 'field', key: 'E2B_API_KEY', input: 'secret', required: true },
        {
          type: 'field',
          key: 'E2B_FUNCTION_TEMPLATE_ID',
          input: 'text',
          required: true,
          validate: true,
          hint: 'immutable <template>:<build-id> ref printed by the Function E2B builder',
        },
        {
          type: 'field',
          key: 'E2B_FUNCTION_TEMPLATE_GENERATION',
          input: 'text',
          required: true,
          validate: true,
          hint: 'release generation printed by the Function E2B builder',
        },
      ],
      currentWhen: { kind: 'truthy', key: 'E2B_ENABLED' },
    },
    daytona: {
      hint: 'dedicated Function code and CLI sandboxes',
      env: {
        NEXT_PUBLIC_E2B_ENABLED: 'false',
        NEXT_PUBLIC_SANDBOXES_ENABLED: 'true',
      },
      prompts: [
        {
          type: 'field',
          key: 'DAYTONA_API_KEY',
          input: 'secret',
          required: true,
        },
        {
          type: 'field',
          key: 'DAYTONA_FUNCTION_SNAPSHOT_ID',
          input: 'text',
          required: true,
          validate: true,
          hint: 'immutable snapshot ID printed by the Function Daytona builder',
        },
      ],
    },
  },
  optionOrder: ['disabled', 'e2b', 'daytona'],
})

export const JOBS_SETUP = defineCapabilitySetup(ASYNC_JOBS_CAPABILITY, {
  label: 'Async jobs',
  message: 'Async job provider?',
  actions: {},
  defaultOption: { hint: 'built-in default' },
  providers: {
    'trigger-dev': {
      hint: 'external background jobs',
      prompts: [
        {
          type: 'field',
          key: 'TRIGGER_PROJECT_ID',
          input: 'text',
          required: true,
        },
        {
          type: 'field',
          key: 'TRIGGER_SECRET_KEY',
          input: 'secret',
          required: true,
        },
      ],
    },
  },
  optionOrder: ['database', 'trigger-dev'],
})

export const CACHE_SETUP = defineCapabilitySetup(CACHE_CAPABILITY, {
  label: 'Redis cache',
  message: 'Cache and realtime coordination?',
  actions: {},
  defaultOption: { hint: 'built-in default' },
  providers: {
    redis: {
      hint: 'recommended for multiple replicas',
      prompts: [
        {
          type: 'field',
          key: 'REDIS_URL',
          input: 'text',
          required: true,
          defaultValue: 'redis://localhost:6379',
          validate: true,
        },
        {
          type: 'field',
          key: 'REDIS_TLS_SERVERNAME',
          input: 'text',
          required: true,
          when: { kind: 'provider-missing-field', key: 'REDIS_TLS_SERVERNAME' },
        },
      ],
    },
  },
  optionOrder: ['database', 'redis'],
})

export const KNOWLEDGE_SETUP = defineCapabilitySetup(OCR_CAPABILITY, {
  label: 'Knowledge and OCR',
  message: 'PDF OCR provider?',
  actions: {},
  defaultOption: { hint: 'built-in default' },
  providers: {
    'azure-mistral': {
      hint: 'Azure model deployment',
      prompts: [
        {
          type: 'field',
          key: 'OCR_AZURE_ENDPOINT',
          input: 'text',
          required: true,
          validate: true,
        },
        {
          type: 'field',
          key: 'OCR_AZURE_MODEL_NAME',
          input: 'text',
          required: true,
        },
        {
          type: 'field',
          key: 'OCR_AZURE_API_KEY',
          input: 'secret',
          required: true,
        },
      ],
    },
    mistral: {
      hint: 'Mistral API key',
      prompts: [
        {
          type: 'field',
          key: 'MISTRAL_API_KEY',
          input: 'secret',
          required: true,
        },
      ],
    },
  },
  optionOrder: ['local', 'mistral', 'azure-mistral'],
})

/**
 * Model and width for the OpenAI family, which reaches the same two variables
 * every other family does. Both are optional here: leaving them unset keeps the
 * `text-embedding-3-small` at 1536 dimensions that knowledge bases have always
 * been created with.
 */
const OPENAI_EMBEDDING_MODEL_PROMPTS = [
  {
    /**
     * A choice rather than a free-text field, so picking an OpenAI-family
     * provider always writes a model this family can serve. As a text field it
     * pre-filled with whatever was configured before, so switching here from
     * Gemini or Ollama silently carried that model forward and the transition
     * then rejected the selection the operator had just made.
     */
    type: 'choice',
    id: 'openai-embedding-model',
    message: 'Embedding model?',
    options: [
      {
        id: 'small',
        label: 'text-embedding-3-small (default)',
        currentWhen: {
          kind: 'any',
          conditions: [
            { kind: 'equals', key: 'KB_EMBEDDING_MODEL', value: 'text-embedding-3-small' },
            { kind: 'not', condition: { kind: 'present', key: 'KB_EMBEDDING_MODEL' } },
          ],
        },
        env: { KB_EMBEDDING_MODEL: 'text-embedding-3-small' },
      },
      {
        id: 'large',
        label: 'text-embedding-3-large',
        currentWhen: { kind: 'equals', key: 'KB_EMBEDDING_MODEL', value: 'text-embedding-3-large' },
        env: { KB_EMBEDDING_MODEL: 'text-embedding-3-large' },
      },
    ],
  },
  {
    type: 'field',
    key: 'EMBEDDING_OUTPUT_DIMS',
    input: 'text',
    hint: 'optional vector width for new knowledge bases: 768, 1024, 1536 (default), or 3072',
    validate: true,
  },
] as const satisfies readonly SetupPrompt[]

export const KNOWLEDGE_EMBEDDINGS_SETUP = defineCapabilitySetup(KNOWLEDGE_EMBEDDINGS_CAPABILITY, {
  label: 'Knowledge embeddings',
  message: 'Knowledge embedding provider?',
  actions: {},
  providers: {
    'azure-openai': {
      hint: 'preferred when configured; falls back to other configured providers',
      prompts: [
        {
          type: 'field',
          key: 'AZURE_OPENAI_ENDPOINT',
          input: 'text',
          required: true,
          validate: true,
        },
        {
          type: 'field',
          key: 'AZURE_OPENAI_API_VERSION',
          input: 'text',
          required: true,
        },
        {
          type: 'field',
          key: 'AZURE_OPENAI_API_KEY',
          input: 'secret',
          required: true,
        },
        {
          type: 'field',
          key: 'KB_OPENAI_MODEL_NAME',
          input: 'text',
          hint: 'optional Azure deployment name; defaults to the embedding model id',
        },
        ...OPENAI_EMBEDDING_MODEL_PROMPTS,
      ],
    },
    openai: {
      hint: 'direct OpenAI with optional key rotation',
      prompts: [
        {
          type: 'choice',
          id: 'openai-credentials',
          message: 'OpenAI credentials?',
          options: [
            {
              id: 'single',
              label: 'Single API key',
              currentWhen: { kind: 'present', key: 'OPENAI_API_KEY' },
              prompts: [{ type: 'field', key: 'OPENAI_API_KEY', input: 'secret', required: true }],
            },
            {
              id: 'rotating',
              label: 'Rotating key pool',
              currentWhen: {
                kind: 'any',
                conditions: [
                  { kind: 'present', key: 'OPENAI_API_KEY_1' },
                  { kind: 'present', key: 'OPENAI_API_KEY_2' },
                  { kind: 'present', key: 'OPENAI_API_KEY_3' },
                ],
              },
              prompts: [
                { type: 'field', key: 'OPENAI_API_KEY_1', input: 'secret', required: true },
                {
                  type: 'field',
                  key: 'OPENAI_API_KEY_2',
                  input: 'secret',
                  hint: 'optional rotating key',
                },
                {
                  type: 'field',
                  key: 'OPENAI_API_KEY_3',
                  input: 'secret',
                  hint: 'optional rotating key',
                },
              ],
            },
          ],
        },
        ...OPENAI_EMBEDDING_MODEL_PROMPTS,
      ],
    },
    openrouter: {
      hint: 'fallback for OpenAI knowledge embedding models',
      prompts: [
        {
          type: 'field',
          key: 'OPENROUTER_API_KEY',
          input: 'secret',
          required: true,
        },
        ...OPENAI_EMBEDDING_MODEL_PROMPTS,
      ],
    },
    gemini: {
      hint: 'gemini-embedding-001, at 768, 1536, or 3072 dimensions',
      /**
       * `KB_EMBEDDING_MODEL` is what routes embeddings to Gemini, so the option
       * writes it rather than asking: picking Gemini here *is* the choice of
       * model, and there is only one Gemini model knowledge bases can use.
       */
      env: { KB_EMBEDDING_MODEL: 'gemini-embedding-001' },
      prompts: [
        {
          type: 'choice',
          id: 'gemini-credentials',
          message: 'Gemini credentials?',
          options: [
            {
              id: 'single',
              label: 'Single API key',
              currentWhen: { kind: 'present', key: 'GEMINI_API_KEY' },
              prompts: [{ type: 'field', key: 'GEMINI_API_KEY', input: 'secret', required: true }],
            },
            {
              id: 'rotating',
              label: 'Rotating key pool',
              currentWhen: {
                kind: 'any',
                conditions: [
                  { kind: 'present', key: 'GEMINI_API_KEY_1' },
                  { kind: 'present', key: 'GEMINI_API_KEY_2' },
                  { kind: 'present', key: 'GEMINI_API_KEY_3' },
                ],
              },
              prompts: [
                { type: 'field', key: 'GEMINI_API_KEY_1', input: 'secret', required: true },
                {
                  type: 'field',
                  key: 'GEMINI_API_KEY_2',
                  input: 'secret',
                  hint: 'optional rotating key',
                },
                {
                  type: 'field',
                  key: 'GEMINI_API_KEY_3',
                  input: 'secret',
                  hint: 'optional rotating key',
                },
              ],
            },
          ],
        },
        {
          type: 'field',
          key: 'EMBEDDING_OUTPUT_DIMS',
          input: 'text',
          hint: 'vector width for new knowledge bases: 768, 1536 (default), or 3072',
          validate: true,
        },
      ],
    },
    ollama: {
      hint: 'embeddings on your own Ollama; no API key, nothing billed',
      prompts: [
        {
          type: 'field',
          key: 'OLLAMA_URL',
          input: 'text',
          required: true,
          hint: 'e.g. http://localhost:11434, or http://host.docker.internal:11434 in Docker',
          validate: true,
        },
        {
          type: 'field',
          key: 'KB_EMBEDDING_MODEL',
          input: 'text',
          required: true,
          defaultValue: 'ollama/nomic-embed-text',
          hint: 'ollama/<model>, pulled on that server (nomic-embed-text is 768)',
        },
        {
          /**
           * Optional and undefaulted on purpose. Sim reads the width from the
           * server when this is unset, which is more reliable than any answer
           * the operator can give here — and a default of 768 would be wrong
           * for a 384-wide model such as `all-minilm` while also suppressing
           * the lookup that would have got it right.
           */
          type: 'field',
          key: 'EMBEDDING_OUTPUT_DIMS',
          input: 'text',
          hint: 'optional — leave blank and Sim reads the width from your Ollama server',
          validate: true,
        },
      ],
    },
  },
  optionOrder: ['openai', 'azure-openai', 'gemini', 'ollama', 'openrouter'],
})

export const CAPABILITY_SETUPS = [
  EMAIL_SETUP,
  STORAGE_SETUP,
  SANDBOX_SETUP,
  JOBS_SETUP,
  CACHE_SETUP,
  KNOWLEDGE_SETUP,
  KNOWLEDGE_EMBEDDINGS_SETUP,
] as const

const configuredCapabilityIds = new Set(CAPABILITY_SETUPS.map((setup) => setup.definition.id))
const missingCapabilitySetups = ENV_CAPABILITIES.filter(
  (capability) => !configuredCapabilityIds.has(capability.id)
)
if (missingCapabilitySetups.length > 0) {
  throw new Error(
    `Missing CLI setup for capabilities: ${missingCapabilitySetups.map((capability) => capability.id).join(', ')}`
  )
}

export type CapabilitySetupId = (typeof CAPABILITY_SETUPS)[number]['definition']['id']
export type SetupFeatureId = CapabilitySetupId | 'chat' | 'llm' | 'integration'

export const SETUP_FEATURES: readonly { id: SetupFeatureId; label: string }[] = [
  ...CAPABILITY_SETUPS.map((setup) => ({
    id: setup.definition.id,
    label: setup.label,
  })),
  { id: 'chat', label: 'Chat' },
  { id: 'llm', label: 'LLM API keys' },
  { id: 'integration', label: 'OAuth integration' },
]

export function getCapabilitySetup(id: string): CapabilitySetupDefinition | null {
  return CAPABILITY_SETUPS.find((setup) => setup.definition.id === id) ?? null
}

export function getSetupCommand(id: string): string {
  return `npx sim-setup add ${id}`
}

type OAuthClientSetupFields = {
  [TId in OAuthClientCapabilityId]: Record<
    OAuthClientCapabilityField<TId>,
    { input: 'text' | 'secret' }
  >
}

export const OAUTH_CLIENT_SETUP_FIELDS = {
  google: {
    GOOGLE_CLIENT_ID: { input: 'text' },
    GOOGLE_CLIENT_SECRET: { input: 'secret' },
  },
  x: { X_CLIENT_ID: { input: 'text' }, X_CLIENT_SECRET: { input: 'secret' } },
  tiktok: {
    TIKTOK_CLIENT_ID: { input: 'text' },
    TIKTOK_CLIENT_SECRET: { input: 'secret' },
  },
  confluence: {
    CONFLUENCE_CLIENT_ID: { input: 'text' },
    CONFLUENCE_CLIENT_SECRET: { input: 'secret' },
  },
  jira: {
    JIRA_CLIENT_ID: { input: 'text' },
    JIRA_CLIENT_SECRET: { input: 'secret' },
  },
  calcom: { CALCOM_CLIENT_ID: { input: 'text' } },
  airtable: {
    AIRTABLE_CLIENT_ID: { input: 'text' },
    AIRTABLE_CLIENT_SECRET: { input: 'secret' },
  },
  bitbucket: {
    BITBUCKET_CLIENT_ID: { input: 'text' },
    BITBUCKET_CLIENT_SECRET: { input: 'secret' },
  },
  'github-repositories': {
    GITHUB_APP_CLIENT_ID: { input: 'text' },
    GITHUB_APP_CLIENT_SECRET: { input: 'secret' },
  },
  notion: {
    NOTION_CLIENT_ID: { input: 'text' },
    NOTION_CLIENT_SECRET: { input: 'secret' },
  },
  microsoft: {
    MICROSOFT_CLIENT_ID: { input: 'text' },
    MICROSOFT_CLIENT_SECRET: { input: 'secret' },
  },
  clickup: {
    CLICKUP_CLIENT_ID: { input: 'text' },
    CLICKUP_CLIENT_SECRET: { input: 'secret' },
  },
  linear: {
    LINEAR_CLIENT_ID: { input: 'text' },
    LINEAR_CLIENT_SECRET: { input: 'secret' },
  },
  attio: {
    ATTIO_CLIENT_ID: { input: 'text' },
    ATTIO_CLIENT_SECRET: { input: 'secret' },
  },
  box: {
    BOX_CLIENT_ID: { input: 'text' },
    BOX_CLIENT_SECRET: { input: 'secret' },
  },
  docusign: {
    DOCUSIGN_CLIENT_ID: { input: 'text' },
    DOCUSIGN_CLIENT_SECRET: { input: 'secret' },
  },
  dropbox: {
    DROPBOX_CLIENT_ID: { input: 'text' },
    DROPBOX_CLIENT_SECRET: { input: 'secret' },
  },
  slack: {
    SLACK_CLIENT_ID: { input: 'text' },
    SLACK_CLIENT_SECRET: { input: 'secret' },
  },
  reddit: {
    REDDIT_CLIENT_ID: { input: 'text' },
    REDDIT_CLIENT_SECRET: { input: 'secret' },
  },
  wealthbox: {
    WEALTHBOX_CLIENT_ID: { input: 'text' },
    WEALTHBOX_CLIENT_SECRET: { input: 'secret' },
  },
  webflow: {
    WEBFLOW_CLIENT_ID: { input: 'text' },
    WEBFLOW_CLIENT_SECRET: { input: 'secret' },
  },
  asana: {
    ASANA_CLIENT_ID: { input: 'text' },
    ASANA_CLIENT_SECRET: { input: 'secret' },
  },
  pipedrive: {
    PIPEDRIVE_CLIENT_ID: { input: 'text' },
    PIPEDRIVE_CLIENT_SECRET: { input: 'secret' },
  },
  hubspot: {
    HUBSPOT_CLIENT_ID: { input: 'text' },
    HUBSPOT_CLIENT_SECRET: { input: 'secret' },
  },
  linkedin: {
    LINKEDIN_CLIENT_ID: { input: 'text' },
    LINKEDIN_CLIENT_SECRET: { input: 'secret' },
  },
  instagram: {
    INSTAGRAM_CLIENT_ID: { input: 'text' },
    INSTAGRAM_CLIENT_SECRET: { input: 'secret' },
  },
  salesforce: {
    SALESFORCE_CLIENT_ID: { input: 'text' },
    SALESFORCE_CLIENT_SECRET: { input: 'secret' },
  },
  shopify: {
    SHOPIFY_CLIENT_ID: { input: 'text' },
    SHOPIFY_CLIENT_SECRET: { input: 'secret' },
  },
  zoom: {
    ZOOM_CLIENT_ID: { input: 'text' },
    ZOOM_CLIENT_SECRET: { input: 'secret' },
  },
  wordpress: {
    WORDPRESS_CLIENT_ID: { input: 'text' },
    WORDPRESS_CLIENT_SECRET: { input: 'secret' },
  },
  spotify: {
    SPOTIFY_CLIENT_ID: { input: 'text' },
    SPOTIFY_CLIENT_SECRET: { input: 'secret' },
  },
  monday: {
    MONDAY_CLIENT_ID: { input: 'text' },
    MONDAY_CLIENT_SECRET: { input: 'secret' },
  },
  trello: { TRELLO_API_KEY: { input: 'secret' } },
  'zoho-desk': {
    ZOHO_CLIENT_ID: { input: 'text' },
    ZOHO_CLIENT_SECRET: { input: 'secret' },
  },
} satisfies OAuthClientSetupFields

export function getOAuthClientSetupFields(
  id: OAuthClientCapabilityId
): readonly { key: string; input: 'text' | 'secret' }[] {
  const runtimeFields = OAUTH_CLIENT_CAPABILITIES[id] as readonly string[]
  const setupFields = OAUTH_CLIENT_SETUP_FIELDS[id] as Record<string, { input: 'text' | 'secret' }>
  const unknownFields = Object.keys(setupFields).filter((key) => !runtimeFields.includes(key))
  const missingFields = runtimeFields.filter((key) => !Object.hasOwn(setupFields, key))
  if (unknownFields.length > 0 || missingFields.length > 0) {
    throw new Error(
      `OAuth setup ${id} field mapping drifted (missing: ${missingFields.join(', ') || 'none'}; unknown: ${unknownFields.join(', ') || 'none'})`
    )
  }
  return runtimeFields.map((key) => ({ key, input: setupFields[key].input }))
}

export function matchesSetupCondition(
  condition: SetupCondition,
  values: EnvCapabilityValues
): boolean {
  if (condition.kind === 'present') return hasEnvCapabilityValue(values, condition.key)
  if (condition.kind === 'truthy') {
    const value =
      values instanceof Map
        ? values.get(condition.key)
        : (values as Readonly<Record<string, unknown>>)[condition.key]
    return value === true || value === 1 || String(value).toLowerCase() === 'true'
  }
  if (condition.kind === 'equals') {
    const value =
      values instanceof Map
        ? values.get(condition.key)
        : (values as Readonly<Record<string, unknown>>)[condition.key]
    return hasEnvCapabilityValue(values, condition.key) && String(value).trim() === condition.value
  }
  if (condition.kind === 'all') {
    return condition.conditions.every((child) => matchesSetupCondition(child, values))
  }
  if (condition.kind === 'any') {
    return condition.conditions.some((child) => matchesSetupCondition(child, values))
  }
  return !matchesSetupCondition(condition.condition, values)
}
