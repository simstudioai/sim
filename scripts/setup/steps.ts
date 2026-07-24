import { browserKeyFlow } from './cli-auth.ts'
import type { Detection } from './detect.ts'
import {
  type EnvFile,
  generateSecret,
  isPlaceholder,
  isTruthy,
  isUsableSecret,
  SECRET_KEYS,
} from './env-files.ts'
import * as p from './prompter.ts'
import { link, theme } from './theme.ts'
import { FLAG_TWINS, hasMailProvider, LOGIN_PROVIDERS, SELF_HOST_UNLOCKS } from './twins.ts'

/** Reuses existing valid secrets (never regenerates them) and generates the rest. */
export function collectSecrets(existing: EnvFile): Record<string, string> {
  const secrets: Record<string, string> = {}
  const generated: string[] = []
  const replaced: string[] = []
  for (const key of SECRET_KEYS) {
    const current = existing.vars.get(key)
    if (current && isUsableSecret(key, current)) {
      secrets[key] = current
    } else {
      secrets[key] = generateSecret()
      // A key the app would reject never successfully encrypted anything, so
      // replacing it cannot orphan existing ciphertext.
      if (current && !isPlaceholder(current)) replaced.push(key)
      else generated.push(key)
    }
  }
  if (replaced.length > 0) {
    p.log.warn(
      `Replaced ${replaced.join(', ')} — the existing value is not a 64-character hex key, which the app rejects at runtime.`
    )
  }
  if (generated.length > 0) {
    p.log.step(`Generated ${generated.join(', ')}`)
  }
  return secrets
}

export async function promptCopilotKey(existing?: string): Promise<string | null> {
  if (existing) {
    const keep = await p.confirm({
      message: 'COPILOT_API_KEY is already set — keep it?',
      initialValue: true,
    })
    if (keep) return existing
  }
  p.log.info('Chat is how you talk to Sim — build and manage everything in natural language.')
  const wants = await p.confirm({
    message: 'Generate your Chat API key in the browser? (sign in, one click, done)',
    initialValue: true,
  })
  if (!wants) {
    p.log.info(theme.muted('Skipping — Chat stays disabled until COPILOT_API_KEY is set.'))
    return null
  }
  const key = await browserKeyFlow(process.env.SIM_CLI_AUTH_ORIGIN ?? 'https://www.sim.ai')
  if (!key) {
    p.log.warn('No key received — re-run bun run setup to retry, or set COPILOT_API_KEY yourself.')
    return null
  }
  return key
}

export async function promptLlmKeys(
  detection: Detection,
  custom: boolean
): Promise<Record<string, string>> {
  const values: Record<string, string> = {}
  if (detection.shellLlmKeys.length > 0) {
    const adopt = await p.multiselect({
      message: 'Found LLM API keys in your shell — copy into apps/sim/.env?',
      options: detection.shellLlmKeys.map((key) => ({ value: key, label: key })),
      initialValues: detection.shellLlmKeys,
    })
    for (const key of adopt) {
      const value = process.env[key]
      if (!value) throw new Error(`${key} disappeared from the environment mid-run`)
      values[key] = value
    }
  }
  if (detection.ollamaReachable) {
    const useOllama = await p.confirm({
      message: 'Ollama is running on :11434 — wire it up for local models?',
      initialValue: true,
    })
    if (useOllama) values.OLLAMA_URL = 'http://localhost:11434'
  }
  if (custom && Object.keys(values).length === 0 && detection.shellLlmKeys.length === 0) {
    p.log.info(
      theme.muted('No LLM keys configured — you can add keys per-workspace in the UI later (BYOK).')
    )
  }
  return values
}

type StorageBackend = 'local' | 's3' | 's3compat' | 'azure' | 'gcs'

function detectStorageBackend(vars: Map<string, string>): StorageBackend {
  if (vars.get('AZURE_CONNECTION_STRING') || vars.get('AZURE_ACCOUNT_NAME')) return 'azure'
  if (vars.get('S3_ENDPOINT')) return 's3compat'
  if (vars.get('S3_BUCKET_NAME') || vars.get('AWS_REGION')) return 's3'
  if (vars.get('GCS_BUCKET_NAME')) return 'gcs'
  return 'local'
}

async function required(message: string, initialValue?: string): Promise<string> {
  return p.text({ message, initialValue, validate: (v) => (v ? undefined : 'required') })
}

/**
 * Custom-flow storage step. Local disk is the default; a cloud backend is
 * strongly recommended for containerized deployments (uploads are ephemeral
 * there). Returns the env vars for the chosen backend, or null to keep local.
 */
export async function promptStorage(
  vars: Map<string, string>,
  containerized: boolean
): Promise<Record<string, string> | null> {
  const current = detectStorageBackend(vars)
  const backend = await p.select<StorageBackend>({
    message: 'File storage?',
    options: [
      {
        value: 'local',
        label: 'Local disk',
        hint: containerized
          ? 'files live in the container — LOST on restart; fine only for evaluation'
          : 'fine for local dev (external-fetch flows like Instagram publish need cloud storage)',
      },
      { value: 's3', label: 'AWS S3', hint: 'region + bucket; keys optional with IAM/IRSA' },
      {
        value: 's3compat',
        label: 'S3-compatible (R2, MinIO, B2)',
        hint: 'custom endpoint — fully self-hostable with MinIO',
      },
      { value: 'azure', label: 'Azure Blob', hint: 'connection string or account name + key' },
      {
        value: 'gcs',
        label: 'Google Cloud Storage',
        hint: 'bucket; credentials via ADC by default',
      },
    ],
    initialValue: current,
  })
  if (backend === 'local') return null

  const values: Record<string, string> = {}
  if (backend === 's3' || backend === 's3compat') {
    if (backend === 's3compat') {
      values.S3_ENDPOINT = await required(
        'S3_ENDPOINT (e.g. https://<account>.r2.cloudflarestorage.com)',
        vars.get('S3_ENDPOINT')
      )
      const pathStyle = await p.confirm({
        message: 'Force path-style addressing? (required for MinIO/Ceph, not for R2)',
        initialValue: false,
      })
      if (pathStyle) values.S3_FORCE_PATH_STYLE = 'true'
    }
    values.AWS_REGION = await required(
      'AWS_REGION',
      vars.get('AWS_REGION') ?? (backend === 's3compat' ? 'auto' : undefined)
    )
    values.S3_BUCKET_NAME = await required('S3_BUCKET_NAME', vars.get('S3_BUCKET_NAME'))
    const accessKey = await p.password({
      message: 'AWS_ACCESS_KEY_ID (empty = IAM/instance credential chain)',
    })
    if (accessKey) {
      values.AWS_ACCESS_KEY_ID = accessKey
      values.AWS_SECRET_ACCESS_KEY = await p.password({
        message: 'AWS_SECRET_ACCESS_KEY',
        validate: (v) => (v ? undefined : 'required when an access key id is set'),
      })
    }
  } else if (backend === 'azure') {
    const connectionString = await p.password({
      message: 'AZURE_CONNECTION_STRING (empty = use account name + key)',
    })
    if (connectionString) {
      values.AZURE_CONNECTION_STRING = connectionString
    } else {
      values.AZURE_ACCOUNT_NAME = await required(
        'AZURE_ACCOUNT_NAME',
        vars.get('AZURE_ACCOUNT_NAME')
      )
      values.AZURE_ACCOUNT_KEY = await p.password({
        message: 'AZURE_ACCOUNT_KEY',
        validate: (v) => (v ? undefined : 'required'),
      })
    }
    values.AZURE_STORAGE_CONTAINER_NAME = await required(
      'AZURE_STORAGE_CONTAINER_NAME',
      vars.get('AZURE_STORAGE_CONTAINER_NAME') ?? 'sim-files'
    )
  } else {
    values.GCS_BUCKET_NAME = await required('GCS_BUCKET_NAME', vars.get('GCS_BUCKET_NAME'))
    p.log.info(
      theme.muted(
        'Credentials use Application Default Credentials unless GCS_CREDENTIALS_JSON is set.'
      )
    )
  }
  return values
}

const PROVIDER_CONSOLES: Record<string, string> = {
  google: 'https://console.cloud.google.com/apis/credentials',
  github: 'https://github.com/settings/developers',
  microsoft: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
}

/** Sign-in providers step: credentials in, exact redirect URIs out. */
export async function promptSignInProviders(
  vars: Map<string, string>,
  appUrl: string
): Promise<Record<string, string>> {
  const configured = LOGIN_PROVIDERS.filter((prov) => vars.get(prov.idKey)).map((prov) => prov.id)
  const wanted = await p.multiselect({
    message: 'Social sign-in providers? (email/password login works without any)',
    options: LOGIN_PROVIDERS.map((prov) => ({
      value: prov.id,
      label: prov.label,
      hint: configured.includes(prov.id) ? 'already configured' : undefined,
    })),
    initialValues: configured,
  })
  const values: Record<string, string> = {}
  for (const id of wanted) {
    const provider = LOGIN_PROVIDERS.find((prov) => prov.id === id)
    if (!provider) throw new Error(`unknown provider ${id}`)
    p.log.info(
      `${provider.label}: create an OAuth app at ${link(PROVIDER_CONSOLES[id], PROVIDER_CONSOLES[id])}\n   Redirect URI: ${theme.command(`${appUrl}/api/auth/callback/${id}`)}`
    )
    values[provider.idKey] = await p.text({
      message: provider.idKey,
      initialValue: vars.get(provider.idKey),
      validate: (v) => (v ? undefined : 'required'),
    })
    values[provider.secretKey] = await p.password({
      message: provider.secretKey,
      validate: (v) => (v ? undefined : 'required'),
    })
  }
  return values
}

/** Email step: console logging is the default; MailHog is the one-tap local option. */
export async function promptEmail(vars: Map<string, string>): Promise<Record<string, string>> {
  const choice = await p.select({
    message: 'Email sending?',
    options: [
      {
        value: 'console',
        label: 'None',
        hint: 'emails are logged to the console — fine for local',
      },
      { value: 'mailhog', label: 'MailHog (local)', hint: 'wires SMTP to localhost:1025' },
      { value: 'resend', label: 'Resend', hint: 'paste an API key' },
      { value: 'smtp', label: 'SMTP', hint: 'any SMTP relay' },
    ],
    initialValue: hasMailProvider(vars) ? (vars.get('SMTP_HOST') ? 'smtp' : 'resend') : 'console',
  })
  if (choice === 'console') return {}
  if (choice === 'mailhog') return { SMTP_HOST: 'localhost', SMTP_PORT: '1025' }
  if (choice === 'resend') {
    return {
      RESEND_API_KEY: await p.password({
        message: 'RESEND_API_KEY',
        validate: (v) => (v ? undefined : 'required'),
      }),
    }
  }
  const values: Record<string, string> = {
    SMTP_HOST: await p.text({
      message: 'SMTP_HOST',
      initialValue: vars.get('SMTP_HOST'),
      validate: (v) => (v ? undefined : 'required'),
    }),
    SMTP_PORT: await p.text({ message: 'SMTP_PORT', initialValue: vars.get('SMTP_PORT') ?? '587' }),
  }
  const user = await p.text({
    message: 'SMTP_USER (empty for unauthenticated relays)',
    defaultValue: '',
  })
  if (user) {
    values.SMTP_USER = user
    values.SMTP_PASS = await p.password({ message: 'SMTP_PASS' })
  }
  return values
}

export interface SecurityStepResult {
  sim: Record<string, string>
  mirrorToRealtime: Record<string, string>
}

/** Auth loosening + admin key. DISABLE_AUTH must reach BOTH env files. */
export async function promptSecurity(vars: Map<string, string>): Promise<SecurityStepResult> {
  const sim: Record<string, string> = {}
  const mirrorToRealtime: Record<string, string> = {}

  const disableAuth = await p.confirm({
    message: 'Disable auth entirely? (anonymous access — ONLY for a private network)',
    initialValue: isTruthy(vars.get('DISABLE_AUTH')),
  })
  if (disableAuth) {
    p.log.warn('Anyone who can reach this instance has full access. Never expose it publicly.')
    sim.DISABLE_AUTH = 'true'
    mirrorToRealtime.DISABLE_AUTH = 'true'
  }

  const privateHosts = await p.confirm({
    message:
      'Allow DB/connector tools to reach private hosts? (Docker/K8s service names, localhost — loosens the SSRF guard)',
    initialValue: isTruthy(vars.get('ALLOW_PRIVATE_DATABASE_HOSTS')),
  })
  if (privateHosts) sim.ALLOW_PRIVATE_DATABASE_HOSTS = 'true'

  const existingAdminKey = vars.get('ADMIN_API_KEY')
  if (!existingAdminKey || isPlaceholder(existingAdminKey)) {
    const wantsAdmin = await p.confirm({
      message: 'Generate an ADMIN_API_KEY? (enables the admin API for workflow export/import)',
      initialValue: false,
    })
    if (wantsAdmin) {
      sim.ADMIN_API_KEY = generateSecret()
      p.log.step('Generated ADMIN_API_KEY')
    }
  }
  return { sim, mirrorToRealtime }
}

/** Self-host feature unlocks — always writes BOTH members of each twin pair. */
export async function promptUnlocks(vars: Map<string, string>): Promise<Record<string, string>> {
  const selected = await p.multiselect({
    message: 'Unlock self-host features? (bypasses hosted plan gating)',
    options: SELF_HOST_UNLOCKS.map((unlock) => ({
      value: unlock.server,
      label: unlock.label,
      hint: unlock.hint || undefined,
    })),
    initialValues: SELF_HOST_UNLOCKS.filter((u) => isTruthy(vars.get(u.server))).map(
      (u) => u.server
    ),
  })
  if (selected.length === 0) return {}
  const flags = new Set(selected)
  if (flags.has('ACCESS_CONTROL_ENABLED') && !flags.has('ORGANIZATIONS_ENABLED')) {
    flags.add('ORGANIZATIONS_ENABLED')
    p.log.info(theme.muted('Access control requires organizations — enabling both.'))
  }
  const values: Record<string, string> = {}
  for (const server of flags) {
    values[server] = 'true'
    const twin = FLAG_TWINS.find((pair) => pair.server === server)
    if (twin) values[twin.client] = 'true'
  }
  return values
}
