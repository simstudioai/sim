import { KNOWLEDGE_EMBEDDINGS_SETUP } from './capability-config'
import {
  type CapabilitySetupContext,
  type EnvCapabilitySetupTransition,
  promptOptionalCapabilitySetup,
} from './capability-setup'
import { browserKeyFlow } from './cli-auth'
import { SETUP_CONTEXT } from './context'
import type { Detection } from './detect'
import {
  type EnvFile,
  generateSecret,
  isPlaceholder,
  isTruthy,
  isUsableSecret,
  SECRET_KEYS,
  secretRequirement,
} from './env-files'
import * as p from './prompter'
import { link, theme } from './theme'
import { FLAG_TWINS, LOGIN_PROVIDERS, SELF_HOST_UNLOCKS } from './twins'

/** Where the Chat key is minted when SIM_CLI_AUTH_ORIGIN is unset. */
const DEFAULT_CLI_AUTH_ORIGIN = 'https://www.sim.ai'

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
    const detail = replaced.map((key) => `${key} (${secretRequirement(key)})`).join(', ')
    p.log.warn(`Replaced ${detail} — the app rejects the existing value at runtime.`)
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
    message: 'Generate your Chat API key in the browser?',
    initialValue: true,
  })
  if (!wants) {
    p.log.info(theme.muted('Skipping — the Chat module stays hidden until you re-run setup.'))
    return null
  }
  const key = await browserKeyFlow(process.env.SIM_CLI_AUTH_ORIGIN ?? DEFAULT_CLI_AUTH_ORIGIN)
  if (!key) {
    // Both halves, because the caller writes the opt-out for a null key: a
    // hand-set credential alone restores capability while Chat stays hidden.
    p.log.warn(
      'No key received — re-run npx sim-setup to retry, or set COPILOT_API_KEY and NEXT_PUBLIC_CHAT_DISABLED=false yourself.'
    )
    return null
  }
  return key
}

/**
 * Hides the Chat module when the user skipped the chat key, so a fresh install
 * gets no Chat surfaces rather than ones that reject every message. Written in
 * both directions on every run, so obtaining a key later un-hides it.
 *
 * Only the wizard writes this. Chat is on by default everywhere else, which is
 * what keeps existing deployments unaffected.
 */
export function chatFlagValues(copilotKey: string | null): Record<string, string> {
  return { NEXT_PUBLIC_CHAT_DISABLED: copilotKey ? 'false' : 'true' }
}

/**
 * Escape hatch for Sim devs pointing an install at a non-prod mothership:
 *
 *   SIM_CLI_AUTH_ORIGIN=https://www.staging.sim.ai \
 *   SIM_AGENT_API_URL=https://www.staging.copilot.sim.ai \
 *   npx sim-setup
 *
 * The two belong together — SIM_CLI_AUTH_ORIGIN decides where the Chat key is
 * minted, SIM_AGENT_API_URL decides which backend validates it, and a key from
 * one environment is rejected by the other. Persisting the URL keeps later
 * `docker compose up` / dev runs on the same backend instead of silently
 * reverting to prod once the shell that exported it is gone.
 */
export function mothershipOverride(): Record<string, string> {
  const agentUrl = process.env.SIM_AGENT_API_URL
  const authOrigin = process.env.SIM_CLI_AUTH_ORIGIN
  // Either half alone produces the same cross-environment rejection, just in
  // opposite directions — mint here, validate there. Warning on only one of them
  // would leave the other silent while the copy claims both matter.
  if (authOrigin && !agentUrl) {
    p.log.warn(
      `SIM_CLI_AUTH_ORIGIN mints the Chat key at ${authOrigin}, but SIM_AGENT_API_URL is unset — the app validates against production, which will reject that key. Set both, or neither.`
    )
  } else if (agentUrl && !authOrigin) {
    p.log.warn(
      `SIM_AGENT_API_URL points the app at ${agentUrl}, but SIM_CLI_AUTH_ORIGIN is unset — the Chat key is minted at ${DEFAULT_CLI_AUTH_ORIGIN}, which that backend will reject. Set both, or neither.`
    )
  }
  if (!agentUrl) return {}
  p.log.step(`Using mothership ${agentUrl} (SIM_AGENT_API_URL)`)
  return { SIM_AGENT_API_URL: agentUrl }
}

export async function promptLlmKeys(
  detection: Detection,
  custom: boolean
): Promise<Record<string, string>> {
  const values: Record<string, string> = {}
  if (detection.shellLlmKeys.length > 0) {
    const adopt = await p.multiselect({
      message: `Found LLM API keys in your shell — copy into ${SETUP_CONTEXT.kind === 'source' ? 'apps/sim/.env' : '.env'}?`,
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

/** Configures knowledge embeddings while allowing the user to explicitly defer them. */
export function promptKnowledgeEmbeddings(
  currentValues: ReadonlyMap<string, string>,
  context: CapabilitySetupContext
): Promise<EnvCapabilitySetupTransition | null> {
  return promptOptionalCapabilitySetup(
    KNOWLEDGE_EMBEDDINGS_SETUP,
    currentValues,
    context,
    'knowledge-base indexing and semantic search will remain unavailable'
  )
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
      hint: configured.includes(prov.id) ? 'Currently used' : undefined,
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
      message: `${provider.idKey}${vars.has(provider.idKey) ? ' (Currently used)' : ''}`,
      initialValue: vars.get(provider.idKey),
      validate: (v) => (v ? undefined : 'required'),
    })
    const existingSecret = vars.get(provider.secretKey)
    const secret = await p.password({
      message: existingSecret
        ? `${provider.secretKey} (Currently used); leave empty to keep it`
        : provider.secretKey,
      validate: (value) => (value || existingSecret ? undefined : 'required'),
    })
    const resolvedSecret = secret || existingSecret
    if (!resolvedSecret) throw new Error(`${provider.secretKey} was not provided`)
    values[provider.secretKey] = resolvedSecret
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

  const existingEgressHosts = vars.get('EGRESS_ALLOWED_HOSTS')
  const egressHosts = await p.text({
    message:
      'Hosts on your private network that workflows may reach? (comma-separated, blank for none — widens the SSRF guard)',
    placeholder: 'host.docker.internal,*.svc.cluster.local',
    initialValue: existingEgressHosts ?? '',
    defaultValue: '',
  })
  if (typeof egressHosts === 'string' && egressHosts.trim()) {
    sim.EGRESS_ALLOWED_HOSTS = egressHosts.trim()
  }

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
  if (flags.has('ENTERPRISE_ENABLED')) {
    p.log.info(
      theme.muted(
        'The enterprise switch covers every feature below — pick individual ones only to override it.'
      )
    )
  }
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
