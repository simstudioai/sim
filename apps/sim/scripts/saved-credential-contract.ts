import { prepareToolRequestUrl } from '@/tools/request-transport'
import { type ExecutableToolConfig, isInternalToolConfig } from '@/tools/types'

/**
 * Finds the params of a request tool that steer the host its request goes to.
 *
 * On a credential-only block the saved credential must fill every such param,
 * or anyone allowed to use a shared credential could send its secret to a
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

const PROBE_HOST = 'hostprobe.example.net'
const PROBE_VALUES = [PROBE_HOST, `https://${PROBE_HOST}`]

/**
 * String placeholder shapes tried in turn until the URL builds: plain, numeric,
 * and UUID ids, key-derived hosts (Mailchimp's `-us1` suffix), bare hosts, full base URLs,
 * and a vendor-validated host shape.
 */
const STRING_PLACEHOLDERS = [
  'x',
  '1',
  '00000000-0000-4000-8000-000000000000',
  'key-us1',
  'example.com',
  'https://example.com',
  'dbc-00000000-0000.cloud.databricks.com',
]

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
  // An internal operation has no request URL to probe: its server handler picks the
  // destination, and the AWS families' handlers reach only AWS endpoints.
  if (isInternalToolConfig(tool)) return { params: [], probed: true }
  const params: [string, ProbeableParam][] = Object.entries(tool.params ?? {})
  const stringParams = params.filter(([, param]) => param.type === 'string').map(([name]) => name)

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
  for (const text of STRING_PLACEHOLDERS) {
    const required = Object.fromEntries(
      params
        .filter(([, param]) => param.required === true)
        .map(([name, param]) => [name, placeholderFor(param, text)])
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
          .map(([name]) => [name, text])
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
    return { params: stringParams.filter((name) => DESTINATION_PARAM.test(name)), probed: false }
  }
  return { params: [...steering], probed: true }
}
