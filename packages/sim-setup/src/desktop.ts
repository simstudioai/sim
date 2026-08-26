import { spawnSync } from 'node:child_process'
import { getErrorMessage } from '@sim/utils/errors'
import { discoverConfigurationSources } from './configuration-sources'
import { SetupError } from './errors'
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

/** The env var every deployment sets to its own public origin. */
const APP_URL_KEY = 'NEXT_PUBLIC_APP_URL'

export interface DesktopFlags {
  /** Overrides the deployment origin when the CLI runs away from the install. */
  url?: string
  /** Skips opening the installer in a browser. */
  noOpen: boolean
}

/**
 * The deployment origin the desktop app should be pointed at.
 *
 * Read from every discovered source, not only the one `add` may write: an
 * operator running a Helm release or an external Compose project still needs
 * the URL, and reading it changes nothing.
 */
export function resolveDeploymentUrl(
  sources: readonly { values?: Map<string, string> | null }[],
  override?: string
): string {
  const raw =
    override ?? sources.find((source) => source.values?.get(APP_URL_KEY))?.values?.get(APP_URL_KEY)
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
 * the 302's Location IS the answer, and downloading the artifact here would
 * pull hundreds of megabytes to check a link.
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
  if (response.status === 302 || response.status === 301 || response.status === 307) {
    const location = response.headers.get('location')
    if (!location) return { status: 'unexpected', code: response.status }
    let name = location
    try {
      name = decodeURIComponent(new URL(location).pathname.split('/').pop() ?? location)
    } catch {
      // Keep the raw Location; it is still the most useful thing to print.
    }
    return { status: 'ok', installerUrl: location, installerName: name }
  }
  if (response.status === 404) return { status: 'no-release' }
  if (response.status === 502) return { status: 'feed-unavailable' }
  return { status: 'unexpected', code: response.status }
}

/** Whether the update feed the installed app polls resolves on this deployment. */
export async function probeFeed(
  feedUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const response = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

function describeProbe(probe: DesktopProbe, appUrl: string): string {
  switch (probe.status) {
    case 'ok':
      return `${glyph.pass} Installer resolved: ${probe.installerName}`
    case 'no-release':
      return `${glyph.fail} This deployment reports no desktop release for its channel.`
    case 'feed-unavailable':
      return `${glyph.fail} The deployment could not reach the GitHub release feed.`
    case 'unreachable':
      return `${glyph.fail} Could not reach ${appUrl} — ${probe.error}`
    case 'unexpected':
      return `${glyph.fail} The download endpoint answered ${probe.code}.`
  }
}

function probeHints(probe: DesktopProbe, appUrl: string): string[] {
  switch (probe.status) {
    case 'no-release':
      return [
        'Stable desktop builds are published on GitHub releases of simstudioai/sim.',
        'A brand-new fork with no releases of its own will report this.',
      ]
    case 'feed-unavailable':
      return [
        'The Sim server needs outbound access to api.github.com and github.com.',
        'Unauthenticated GitHub API calls are capped at 60/hour per IP — set GITHUB_TOKEN on the Sim server to raise it to 5000/hour.',
      ]
    case 'unreachable':
      return [
        `Check that Sim is running and reachable at ${appUrl} (npx sim-setup status).`,
        `Pass --url if this machine reaches Sim at a different address.`,
      ]
    default:
      return []
  }
}

export async function runDesktop(flags: DesktopFlags): Promise<number> {
  const appUrl = resolveDeploymentUrl(discoverConfigurationSources(), flags.url)
  const downloadUrl = `${appUrl}${DOWNLOAD_PATH}`

  p.log.step(`Deployment: ${theme.accent(appUrl)}`)

  const spin = p.spinner()
  spin.start('Resolving the desktop installer…')
  const [probe, feedOk] = await Promise.all([
    probeDownload(downloadUrl),
    probeFeed(`${appUrl}${FEED_PATH}`),
  ])
  spin.stop(describeProbe(probe, appUrl))

  if (probe.status !== 'ok') {
    for (const hint of probeHints(probe, appUrl)) {
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

  if (!flags.noOpen && process.platform === 'darwin') {
    const open = await p.confirm({ message: 'Download it now?', initialValue: true })
    if (open) {
      spawnSync('open', [downloadUrl], { stdio: 'ignore' })
    }
  }

  p.outro(theme.accent('Ready.'))
  return 0
}
