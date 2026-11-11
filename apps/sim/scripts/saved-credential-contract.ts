import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig } from '@/blocks/types'
import type { ToolMetadata } from '@/tools/metadata'
import { prepareToolRequestUrl } from '@/tools/request-transport'
import {
  isSavedCredentialPicker,
  OPERATION_RESOLVED_CREDENTIAL_PROVIDERS,
} from '@/tools/shared/saved-credentials'
import { type ExecutableToolConfig, isInternalToolConfig } from '@/tools/types'

/**
 * Finds the params of a request tool that steer the host its request goes to.
 *
 * On a block with a saved-credential picker the saved credential must fill or
 * pin every such param, or anyone allowed to use a shared credential could send its secret to a
 * server of their choosing. The tool's real URL builder is the source of
 * truth: it is called with placeholder values, then with a probe value in each
 * string param, and a param steers the host when the probe lands in it.
 */

interface ProbeableParam {
  type?: unknown
  required?: unknown
}

export interface HostSteeringResult {
  /** Params whose value reaches the request host. */
  params: string[]
  /** False when no placeholder set built the URL, so `params` comes from param names. */
  probed: boolean
}

/**
 * Where no placeholder set builds the URL, params named like a destination are
 * treated as host-steering — deliberately broad, since a miss leaks a secret.
 */
const DESTINATION_PARAM =
  /(host|hostname|domain|endpoint|url|uri|origin|server|region|instance|shop|account|site|org|tenant|workspace|team|subdomain|space|cluster|environment|location|project)(name|slug|id)?$/i

/**
 * Destination-named params of internal-operation tools that are request data, not the host
 * the credential goes to: each operation sends its token only to the vendor's fixed API.
 * Only the operation branch reads it; a request tool's URL is probed instead.
 */
const OPERATION_PAYLOAD_PARAMS: Readonly<Record<string, readonly string[]>> = {
  // The page the remote browser opens; the token goes to api.browser-use.com.
  browser_use_run_task: ['startUrl'],
  // A label CrowdStrike records on the RTR session; the token goes to the credential's Falcon cloud.
  crowdstrike_init_rtr_session: ['origin'],
  // A guild id the operation never sends; it posts only to the channel's discord.com endpoint.
  discord_send_message: ['serverId'],
  // The audio Fireflies downloads; the token goes to api.fireflies.ai.
  fireflies_upload_audio: ['audioUrl'],
  // A filter on the asset's cloud account; the token goes to the credential's Vanta API domain.
  vanta_list_vulnerable_assets: ['assetExternalAccountId'],
  // Search filters sent in the request body; the token goes only to api.zoominfo.com.
  zoominfo_search_companies: ['companyWebsite', 'metroRegion'],
  zoominfo_search_news: ['url'],
  // The status page's own domain, sent as a form field to the UptimeRobot API.
  uptimerobot_create_psp: ['customDomain'],
  uptimerobot_update_psp: ['customDomain'],
}

const PROBE_HOST = 'hostprobe.example.net'
const PROBE_VALUES = [PROBE_HOST, `https://${PROBE_HOST}`]

/**
 * String placeholder shapes tried in turn until the URL builds: plain, numeric,
 * slash-separated, and UUID ids, key-derived hosts (Mailchimp's `-us1` suffix), bare hosts,
 * full base URLs, and a vendor-validated host shape.
 */
const STRING_PLACEHOLDERS = [
  'x',
  '1',
  // A path-shaped model or endpoint id (Higgsfield's `vendor/model`).
  'x/y',
  '00000000-0000-4000-8000-000000000000',
  'key-us1',
  'example.com',
  'https://example.com',
  'dbc-00000000-0000.cloud.databricks.com',
  // A Twilio account SID: Twilio tools refuse to build a URL without one.
  'AC00000000000000000000000000000000',
]

/**
 * A builder that validates each param differently (a base URL beside a numeric
 * id) rejects every single shape, so one more set shapes each param by its name.
 */
function placeholderByName(name: string): string {
  if (/(url|uri|origin|endpoint)$/i.test(name)) return 'https://example.com'
  if (/id$/i.test(name)) return '1'
  return 'x'
}

function placeholderFor(param: ProbeableParam, text: string): unknown {
  switch (param.type) {
    case 'number':
      return 1
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
    case 'json':
      return {}
    default:
      return text
  }
}

/** Same-shaped variants of a placeholder (another id, another tenant host). */
function alternateValues(value: unknown): string[] {
  const text = typeof value === 'string' ? value : 'x'
  return [
    ...STRING_PLACEHOLDERS.filter((candidate) => candidate !== text),
    // Every digit rotated, so a numeric tenant (`1` → `2`) or key-derived host moves.
    text.replace(/\d/g, (digit) => String((Number(digit) + 1) % 10)),
    text.replace(/^([a-z]+)/i, '$1alt'),
  ]
}

export function hostSteeringParams(tool: ExecutableToolConfig): HostSteeringResult {
  const params: [string, ProbeableParam][] = Object.entries(tool.params ?? {})
  const stringParams = params.filter(([, param]) => param.type === 'string').map(([name]) => name)
  // An internal operation has no request URL to probe: its server handler picks the
  // destination from its input, so a destination-named param counts as steering.
  // AWS families resolve their credential in the operation and are skipped by the caller.
  if (isInternalToolConfig(tool)) {
    const payload = new Set(OPERATION_PAYLOAD_PARAMS[tool.id] ?? [])
    return {
      params: stringParams.filter((name) => DESTINATION_PARAM.test(name) && !payload.has(name)),
      probed: false,
    }
  }

  // The URL the shared transport would request, so the probe sees exactly what runs.
  const hostOf = (values: Record<string, unknown>): string | null => {
    try {
      return new URL(prepareToolRequestUrl(tool, values)).host
    } catch {
      return null
    }
  }

  const steering = new Set<string>()
  let probed = false
  const placeholderSets: ((name: string) => string)[] = [
    ...STRING_PLACEHOLDERS.map((text) => () => text),
    placeholderByName,
  ]
  for (const textFor of placeholderSets) {
    const required = Object.fromEntries(
      params
        .filter(([, param]) => param.required === true)
        .map(([name, param]) => [name, placeholderFor(param, textFor(name))])
    )
    // Optional params usually stay unset, but some gate a different host
    // (a "custom endpoint" switch), so each context is probed in turn.
    const withOptionalFlags = {
      ...required,
      ...Object.fromEntries(
        params.filter(([, param]) => param.type === 'boolean').map(([name]) => [name, true])
      ),
    }
    const withOptionalValues = {
      ...withOptionalFlags,
      ...Object.fromEntries(
        params
          .filter(([, param]) => param.required !== true && param.type === 'string')
          .map(([name]) => [name, textFor(name)])
      ),
    }
    for (const context of [required, withOptionalFlags, withOptionalValues]) {
      const baseHost = hostOf(context)
      if (baseHost === null) continue
      probed = true
      const probes = [
        ...PROBE_VALUES,
        // Defeat a suffix check (`endsWith('.vendor.com')`) that does not parse the host.
        `${PROBE_HOST}#.${baseHost}`,
        `${PROBE_HOST}/?.${baseHost}`,
        `https://${PROBE_HOST}#.${baseHost}`,
      ]
      for (const name of stringParams) {
        const landsProbe = probes.some((probe) =>
          hostOf({ ...context, [name]: probe })?.includes(PROBE_HOST)
        )
        // A host validated against a vendor allowlist still steers if two accepted
        // values reach different hosts (another tenant's workspace on the vendor).
        const movesHost = alternateValues(context[name]).some((value) => {
          const host = hostOf({ ...context, [name]: value })
          return host !== null && host !== baseHost
        })
        if (landsProbe || movesHost) steering.add(name)
      }
    }
  }
  if (!probed) {
    return {
      params: stringParams.filter((name) => DESTINATION_PARAM.test(name)),
      probed: false,
    }
  }
  return { params: [...steering], probed: true }
}

/** How the contract reads a tool: its serializable metadata and its executable config. */
export interface SavedCredentialToolLookup {
  metadata: (toolId: string) => ToolMetadata | undefined
  executable: (toolId: string) => ExecutableToolConfig | undefined
}

function operationIds(block: BlockConfig): (string | undefined)[] {
  const operation = block.subBlocks.find((subBlock) => subBlock.id === 'operation')
  const options =
    typeof operation?.options === 'function' ? operation.options() : operation?.options
  const ids = (options ?? []).map((option) => option.id).filter((id): id is string => Boolean(id))
  return ids.length > 0 ? ids : [undefined]
}

function selectedToolId(block: BlockConfig, values: Record<string, unknown>): string | undefined {
  const access = block.tools?.access ?? []
  try {
    return block.tools?.config?.tool?.(values) ?? (access.length === 1 ? access[0] : undefined)
  } catch {
    return access.length === 1 ? access[0] : undefined
  }
}

/**
 * The saved-credential contract of one block: a block with a saved-credential
 * picker (native, or a credential-only successor of `legacies`) must actually
 * receive its credential and must not let a caller redirect it. Every tool
 * authorizes the picker's provider and service-account kind, every param the
 * credential supplies is filled server-side, every mapped param is one the tool
 * takes, and every param that decides the request host is mapped from the
 * credential (`credentialParams`) or pinned to it (`authoritativeParams`).
 * Without this a missing mapping fails at run time with the provider's 401, and
 * an unpinned host param sends a shared credential to a server of the caller's choosing.
 */
export function savedCredentialContractErrors(
  block: BlockConfig,
  legacies: readonly BlockConfig[],
  tools: SavedCredentialToolLookup
): string[] {
  const errors: string[] = []
  const picker = block.subBlocks.find(isSavedCredentialPicker)
  // A legacy block shares its successor's tools but takes the secret inline.
  if (!picker && legacies.length === 0) return errors
  const takesSavedCredential = (block.tools?.access ?? []).some(
    (toolId) => (tools.metadata(toolId)?.oauth?.credentialSuppliedParams?.length ?? 0) > 0
  )
  if (!takesSavedCredential && !picker) return errors
  if (!picker?.serviceId) {
    errors.push(
      `Block "${block.type}": its tools take a saved credential but it has no service-account picker with a serviceId and canonicalParamId 'oauthCredential'.`
    )
    return errors
  }

  // Wherever the picker is hidden or optional, the selected tool must not need a credential-supplied param.
  for (const operation of operationIds(block)) {
    const values = operation === undefined ? {} : { operation }
    const pickerNeeded =
      evaluateSubBlockCondition(picker.condition, values) &&
      (picker.required === true ||
        (typeof picker.required === 'object' && evaluateSubBlockCondition(picker.required, values)))
    if (pickerNeeded) continue
    const toolId = selectedToolId(block, values)
    const tool = toolId ? tools.metadata(toolId) : undefined
    for (const param of tool?.oauth?.credentialSuppliedParams ?? []) {
      if (tool?.params?.[param]?.required) {
        errors.push(
          `Block "${block.type}" (operation ${operation ?? 'default'}) → tool "${toolId}": the credential is not required there but "${param}" is.`
        )
      }
    }
  }

  const successorFields = new Set(block.subBlocks.map((subBlock) => subBlock.id))
  const replacedSecrets = new Set(
    legacies
      .flatMap((legacy) => legacy.subBlocks.map((subBlock) => subBlock.id))
      .filter((id) => !successorFields.has(id))
  )

  for (const toolId of block.tools?.access ?? []) {
    const tool = tools.metadata(toolId)
    const oauth = tool?.oauth
    if (!tool || !oauth) {
      // A successor's tool that takes none of the replaced secrets keeps its own per-call auth
      // (a routing key, a webhook URL) and needs no policy. A native block has no such tools:
      // without a policy the executor never fills the tool's token from the picker.
      const takesReplacedSecret = Object.keys(tool?.params ?? {}).some((param) =>
        replacedSecrets.has(param)
      )
      if (legacies.length === 0 || takesReplacedSecret) {
        errors.push(`Block "${block.type}" → tool "${toolId}": no credential policy (oauth).`)
      }
      continue
    }
    if (oauth.credentialKind !== 'service-account') {
      errors.push(
        `Block "${block.type}" → tool "${toolId}": accepts "${oauth.credentialKind ?? 'any'}" credentials, not the picker's service-account credential.`
      )
    }
    if (oauth.provider !== picker.serviceId) {
      errors.push(
        `Block "${block.type}" → tool "${toolId}": authorizes "${oauth.provider}" but the picker selects "${picker.serviceId}".`
      )
    }
    const mapped = new Set(Object.keys(oauth.credentialParams ?? {}))
    if (!OPERATION_RESOLVED_CREDENTIAL_PROVIDERS.has(oauth.provider)) {
      if (
        oauth.tokenReplacesParams?.length &&
        oauth.credentialParams?.accessToken !== 'accessToken'
      ) {
        errors.push(
          `Block "${block.type}" → tool "${toolId}": tokenReplacesParams needs credentialParams to fill "accessToken" with the minted token.`
        )
      }
      const replacedByToken = new Set(oauth.tokenReplacesParams ?? [])
      for (const param of oauth.credentialSuppliedParams ?? []) {
        if (!mapped.has(param) && !replacedByToken.has(param)) {
          errors.push(
            `Block "${block.type}" → tool "${toolId}": "${param}" is credential-supplied but nothing fills it (add it to credentialParams).`
          )
        }
      }
      const pinned = new Set<string>([...mapped, ...(oauth.authoritativeParams ?? [])])
      const executable = tools.executable(toolId)
      if (!executable) {
        errors.push(
          `Block "${block.type}" → tool "${toolId}": not in the executable tool registry.`
        )
      }
      for (const param of executable ? hostSteeringParams(executable).params : []) {
        if (!pinned.has(param)) {
          errors.push(
            `Block "${block.type}" → tool "${toolId}": "${param}" decides the host the saved credential is sent to but the credential does not fill it (map it in credentialParams or pin it in authoritativeParams).`
          )
        }
      }
    }
    for (const param of mapped) {
      if (!tool.params?.[param]) {
        errors.push(
          `Block "${block.type}" → tool "${toolId}": credentialParams fills "${param}", which the tool does not declare.`
        )
      }
    }
  }
  return errors
}
