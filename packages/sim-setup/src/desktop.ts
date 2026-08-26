import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { openBrowser } from './cli-auth'
import { discoverConfigurationSources } from './configuration-sources'
import { SetupError } from './errors'
import { httpHealth } from './probes'
import * as p from './prompter'
import { glyph, theme } from './theme'
import { APP_URL } from './urls'

/**
 * Where a deployment redirects to the newest installer for its own channel,
 * and the manifest installed shells poll. Both ship in every Sim deployment
 * (`app/api/desktop/update/*`), so a self-hosted install already serves them —
 * there is nothing to build or host.
 */
const DOWNLOAD_PATH = '/api/desktop/update/download'
const FEED_PATH = '/api/desktop/update/latest-mac.yml'

const PROBE_TIMEOUT_MS = 15_000

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 307, 308])

/** The env var every deployment sets to its own public origin. */
const APP_URL_KEY = 'NEXT_PUBLIC_APP_URL'

/** Keeps a rendered artifact name from overrunning the spinner line. */
const MAX_INSTALLER_NAME = 120

/**
 * Strips anything that could move the cursor, repaint, or retitle the terminal.
 *
 * The artifact name is read out of a redirect the deployment chose, so it is
 * remote input on its way to a TTY: percent-encoded ANSI or OSC bytes survive
 * `decodeURIComponent` as real control characters and would let a compromised
 * deployment forge CLI output. C0 (including ESC), DEL, and C1 all go.
 */
export function sanitizeForTerminal(value: string): string {
  return truncate(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''), MAX_INSTALLER_NAME)
}

export interface DesktopFlags {
  /** Overrides the deployment origin when the CLI runs away from the install. */
  url?: string
  noOpen: boolean
}

/**
 * The deployment origin the desktop app should be pointed at.
 *
 * Read from every discovered source, not only the one `add` may write: an
 * operator running a Helm release or an external Compose project still needs
 * the URL, and reading it changes nothing.
 *
 * Sources that disagree are an error rather than a first-match win. This
 * command probes a URL, prints it as the one to trust, and offers to open it —
 * so silently preferring whichever source enumerated first would point an
 * operator with both a local checkout and a real deployment at localhost and
 * never say so. `resolveFeatureSetupDestination` refuses ambiguity the same way.
 */
export function resolveDeploymentUrl(
  sources: readonly { label?: string; values?: Map<string, string> | null }[],
  override?: string
): string {
  const discovered = sources.filter((source) => source.values?.get(APP_URL_KEY))
  const distinct = new Set(discovered.map((source) => source.values?.get(APP_URL_KEY)?.trim()))
  if (!override && distinct.size > 1) {
    throw new SetupError(
      `Found ${distinct.size} configurations naming different ${APP_URL_KEY} values.`,
      [
        ...discovered.map(
          (source) => `${source.label ?? 'configuration'}: ${source.values?.get(APP_URL_KEY)}`
        ),
        'Re-run with --url <deployment url> to say which one the desktop app should use.',
      ]
    )
  }
  const raw = override ?? discovered[0]?.values?.get(APP_URL_KEY)
  if (!raw) {
    // A wizard-provisioned local install has the compose interpolation default
    // rather than an explicit value, so an absent key is not a misconfiguration.
    return APP_URL
  }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new SetupError(`${APP_URL_KEY} is not a valid URL: ${raw}`, [
      'Set it to the origin browsers use to reach Sim, e.g. https://sim.example.com',
    ])
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SetupError(`${APP_URL_KEY} must be an http(s) URL: ${raw}`)
  }
  return url.origin
}

export type DesktopProbe =
  | { status: 'ok'; installerUrl: string; installerName: string }
  | { status: 'no-release' }
  | { status: 'feed-unavailable' }
  | { status: 'unreachable'; error: string }
  | { status: 'unexpected'; code: number }

/**
 * Asks the deployment to resolve its own installer, following no redirects:
 * the redirect's Location IS the answer, and downloading the artifact here
 * would pull hundreds of megabytes to check a link.
 */
export async function probeDownload(
  downloadUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<DesktopProbe> {
  let response: Response
  try {
    response = await fetchImpl(downloadUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (error) {
    return { status: 'unreachable', error: getErrorMessage(error, 'request failed') }
  }
  if (REDIRECT_STATUSES.has(response.status)) {
    const location = response.headers.get('location')
    if (!location) return { status: 'unexpected', code: response.status }
    let name = location
    try {
      name = decodeURIComponent(new URL(location).pathname.split('/').pop() ?? location)
    } catch {
      // Keep the raw Location; it is still the most useful thing to print.
    }
    return { status: 'ok', installerUrl: location, installerName: sanitizeForTerminal(name) }
  }
  if (response.status === 404) return { status: 'no-release' }
  if (response.status === 502) return { status: 'feed-unavailable' }
  return { status: 'unexpected', code: response.status }
}

/**
 * One exhaustive switch for both the headline and its follow-up hints, so a
 * new {@link DesktopProbe} status cannot compile with its hints silently
 * missing — which a `default` arm would have allowed.
 */
export function describeProbe(
  probe: DesktopProbe,
  appUrl: string
): { headline: string; hints: readonly string[] } {
  switch (probe.status) {
    case 'ok':
      return { headline: `${glyph.pass} Installer resolved: ${probe.installerName}`, hints: [] }
    case 'no-release':
      return {
        headline: `${glyph.fail} This deployment reports no desktop release for its channel.`,
        hints: [
          'Stable desktop builds are published on GitHub releases of simstudioai/sim.',
          'A brand-new fork with no releases of its own will report this.',
        ],
      }
    case 'feed-unavailable':
      return {
        headline: `${glyph.fail} The deployment could not reach the GitHub release feed.`,
        hints: [
          'The Sim server needs outbound access to api.github.com and github.com.',
          'Unauthenticated GitHub API calls are capped at 60/hour per IP — set GITHUB_TOKEN on the Sim server to raise it to 5000/hour.',
        ],
      }
    case 'unreachable':
      return {
        headline: `${glyph.fail} Could not reach ${appUrl} — ${probe.error}`,
        hints: [
          `Check that Sim is running and reachable at ${appUrl} (npx sim-setup status).`,
          'Pass --url if this machine reaches Sim at a different address.',
        ],
      }
    case 'unexpected':
      return { headline: `${glyph.fail} The download endpoint answered ${probe.code}.`, hints: [] }
  }
}

export async function runDesktop(flags: DesktopFlags): Promise<number> {
  // Discovery shells out to `docker compose ls/config` and `helm list/get
  // values`, so it is seconds of blocking work — and every bit of it is
  // discarded when --url already names the deployment.
  const appUrl = resolveDeploymentUrl(flags.url ? [] : discoverConfigurationSources(), flags.url)
  const downloadUrl = `${appUrl}${DOWNLOAD_PATH}`

  p.log.step(`Deployment: ${theme.accent(appUrl)}`)

  const spin = p.spinner()
  spin.start('Resolving the desktop installer…')
  const [probe, feedOk] = await Promise.all([
    probeDownload(downloadUrl),
    httpHealth(`${appUrl}${FEED_PATH}`, PROBE_TIMEOUT_MS),
  ])
  const { headline, hints } = describeProbe(probe, appUrl)
  spin.stop(headline)

  if (probe.status !== 'ok') {
    for (const hint of hints) {
      p.log.info(hint)
    }
    p.outro(theme.error('The desktop installer could not be resolved.'))
    return 1
  }

  if (!feedOk) {
    p.log.warn(
      `${FEED_PATH} did not resolve — the app will install but will not auto-update from this deployment.`
    )
  }

  p.note(
    [
      `1. Download and install Sim:`,
      `   ${theme.accent(downloadUrl)}`,
      '',
      `2. Open Sim, then choose ${theme.command('Sim → Server…')} in the menu bar.`,
      '',
      `3. Enter your server URL and press Connect:`,
      `   ${theme.accent(appUrl)}`,
      '',
      theme.muted('Sim relaunches against your deployment and updates from it from then on.'),
      theme.muted('The desktop app is macOS-only today; the web app works everywhere.'),
    ].join('\n'),
    'Connect the desktop app'
  )

  if (!flags.noOpen) {
    if (await p.confirm({ message: 'Download it now?', initialValue: true })) {
      openBrowser(downloadUrl)
    }
  }

  p.outro(theme.accent('Ready.'))
  return 0
}
