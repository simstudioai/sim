/**
 * Audits the desktop IPC channel table against the preload bridge.
 *
 * This is the companion to `check-desktop-bridge-contract.ts` and exists
 * because that one has a structural blind spot: it compares the bridge types
 * against a snapshot the same PR is allowed to regenerate, so a change is only
 * caught if the author forgets to run the updater. Nothing there derives truth
 * from the running wire surface.
 *
 * This script has no snapshot. Every fact it checks is read from the source
 * both sides actually execute:
 *
 * 1. Every channel the preload calls is declared in the main-process table,
 *    and every declared channel is reachable from the preload. A channel on
 *    one side only is either dead code or a call that silently no-ops.
 * 2. Within a channel-name family (`terminal:`, `browser-agent:`, …) the
 *    `gate` and `requires` values agree, unless the outlier carries an
 *    explicit acknowledgment. A surface toggle that a new channel forgets is
 *    invisible in review — the channel simply works when it should not.
 *
 * Deviations are legitimate and common: a channel that READS or RESETS a
 * surface's settings must keep working while the surface is off, or the user
 * could never turn it back on. Each one says so in its own spec:
 *
 *   'browser-import:sites': {
 *     gate: 'app-origin',
 *     deviationReason: 'a read of already-imported data; settings lists these
 *       hosts to show what an import brought over',
 *     ...
 *   }
 *
 * A typed field rather than a `-- migration-safe:`-style comment because here
 * the thing being annotated IS typed data. A comment is bound by position, so
 * reordering the table would silently transfer an acknowledgment to whichever
 * channel moved underneath it; a field moves with its channel.
 *
 * Run: `bun run check:desktop-ipc`
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const IPC_SOURCE_PATH = resolve(ROOT, 'apps/desktop/src/main/ipc.ts')
/**
 * Every preload that can reach the handler table. The browser-page preload is
 * a separate bundle with its own channels — omitting it made this audit report
 * `browser-credentials:form-state` as dead when it is the one channel a real
 * page depends on.
 */
const PRELOAD_SOURCE_PATHS = [
  resolve(ROOT, 'apps/desktop/src/preload/index.ts'),
  resolve(ROOT, 'apps/desktop/src/preload/browser/index.ts'),
]

const MAIN_SOURCE_DIR = resolve(ROOT, 'apps/desktop/src/main')

/**
 * Every channel declares a gate, so an empty parse is a parser failure rather
 * than a real value — and a family that all parsed empty would agree with
 * itself and assert nothing. Asserting per channel turns silent vacuity into
 * a loud error, which is the failure mode this whole script exists to prevent
 * in its sibling audit.
 */
const REQUIRED_FIELD = 'gate'

/**
 * How the main process pushes to the renderer. These channels never appear in
 * the handler table — nothing is registered for them — so the reverse
 * direction has to be verified against the senders themselves rather than
 * skipped by prefix, which would have made the check vacuous for four of the
 * six families.
 */
const PUSH_CALL_PATTERN = /(?:\.send|broadcast)\(\s*'([^']+)'/g

interface ChannelDecl {
  name: string
  gate: string
  requires: string
  line: number
  /** The channel's own `deviationReason`, or null when it declares none. */
  deviationReason: string | null
}

/** The handler table is one `'channel': {` entry per line at a fixed depth. */
function parseChannelTable(source: string): ChannelDecl[] {
  const lines = source.split('\n')
  const decls: ChannelDecl[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^ {4}'([^']+)':\s*\{$/.exec(lines[i])
    if (!match) continue
    const closing = lines.indexOf('    },', i)
    if (closing < 0) continue
    const body = lines.slice(i, closing).join('\n')
    // Read from the channel's OWN body, so the acknowledgment travels with it
    // if the table is ever reordered.
    const reason = /deviationReason:\s*\n?\s*(?:'([^']*)'|"([^"]*)")/.exec(body)
    decls.push({
      name: match[1],
      gate: /gate:\s*'([^']+)'/.exec(body)?.[1] ?? '',
      requires: /requires:\s*'([^']+)'/.exec(body)?.[1] ?? '',
      line: i + 1,
      deviationReason: reason ? (reason[1] ?? reason[2] ?? '').trim() : null,
    })
  }
  return decls
}

function familyOf(channel: string): string {
  return channel.slice(0, channel.indexOf(':'))
}

/** The value most channels in a family use; ties resolve to the first seen. */
function dominant(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * Channel names bound to a module constant, so a call written as
 * `ipcRenderer.send(FORM_STATE_CHANNEL, …)` resolves like an inline literal.
 * Only channel-shaped values (`family:name`) are collected, which keeps every
 * other string constant in the file out of the map.
 */
function channelConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>()
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*:[^']*)'/g)) {
    constants.set(match[1], match[2])
  }
  return constants
}

/** Every channel any main-process module pushes to a renderer. */
async function channelsPushedFromMain(): Promise<Set<string>> {
  const pushed = new Set<string>()
  const entries = await readdir(MAIN_SOURCE_DIR, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue
    const source = await readFile(resolve(entry.parentPath, entry.name), 'utf8')
    for (const match of source.matchAll(PUSH_CALL_PATTERN)) pushed.add(match[1])
  }
  return pushed
}

function channelsFromPreload(source: string, methods: string): Set<string> {
  const constants = channelConstants(source)
  const found = new Set<string>()
  const pattern = new RegExp(
    `ipcRenderer\\.(?:${methods})\\(\\s*(?:'([^']+)'|([A-Za-z_$][\\w$]*))`,
    'g'
  )
  for (const match of source.matchAll(pattern)) {
    const name = match[1] ?? constants.get(match[2] ?? '')
    if (name) found.add(name)
  }
  return found
}

async function main(): Promise<void> {
  const [ipcSource, ...preloadSources] = await Promise.all([
    readFile(IPC_SOURCE_PATH, 'utf8'),
    ...PRELOAD_SOURCE_PATHS.map((path) => readFile(path, 'utf8')),
  ])

  const declared = parseChannelTable(ipcSource)
  // Completeness, not just non-emptiness. A total parse failure is obvious; the
  // dangerous case is PARTIAL — 48 of 49 channels parsed, the audit prints
  // "passed", and the one it skipped is the one the PR added. Counting the
  // channel-shaped keys in the file independently of how the bodies parse is
  // what makes a skipped entry loud.
  // Deliberately looser than the parser's own pattern: it counts the KEY only,
  // with no constraint on what follows. Deriving both counts from the same
  // shape would make them drop together and agree, which is exactly the
  // vacuous pass this guard exists to prevent.
  const expectedChannels = (ipcSource.match(/^ {4}'[a-z-]+:[^']*':/gm) ?? []).length
  if (declared.length !== expectedChannels) {
    throw new Error(
      `Parsed ${declared.length} channels from ${relative(ROOT, IPC_SOURCE_PATH)} but the file ` +
        `declares ${expectedChannels} — the table's shape changed and this script can no longer ` +
        'read all of it. Update parseChannelTable rather than letting the audit pass vacuously.'
    )
  }

  const unparsed = declared.filter((channel) => channel[REQUIRED_FIELD] === '')
  if (unparsed.length > 0) {
    throw new Error(
      `Could not read \`${REQUIRED_FIELD}\` for ${unparsed.length} channel(s) ` +
        `(${unparsed.map((channel) => channel.name).join(', ')}). Every channel declares one, so ` +
        'this is a parser failure — a family that all parsed empty would agree with itself and ' +
        'assert nothing. Update parseChannelTable rather than letting the audit pass vacuously.'
    )
  }

  const called = new Set<string>()
  const subscribed = new Set<string>()
  for (const source of preloadSources) {
    for (const name of channelsFromPreload(source, 'invoke|send')) called.add(name)
    for (const name of channelsFromPreload(source, 'on|once')) subscribed.add(name)
  }
  const declaredNames = new Set(declared.map((channel) => channel.name))
  const preloadLabel = 'apps/desktop/src/preload'
  const failures: string[] = []

  for (const name of called) {
    if (!declaredNames.has(name)) {
      failures.push(
        `${preloadLabel}: calls '${name}', which no main-process handler declares. The call ` +
          'resolves to nothing at runtime.'
      )
    }
  }

  for (const channel of declared) {
    if (called.has(channel.name)) continue
    failures.push(
      `${relative(ROOT, IPC_SOURCE_PATH)}:${channel.line}: '${channel.name}' is handled but never ` +
        'called from the preload — dead channel, or a bridge method that was dropped.'
    )
  }

  const pushed = await channelsPushedFromMain()
  for (const name of subscribed) {
    if (declaredNames.has(name) || pushed.has(name)) continue
    failures.push(
      `${preloadLabel}: subscribes to '${name}', but no main-process module ever sends it — the ` +
        'listener can never fire.'
    )
  }

  const families = new Map<string, ChannelDecl[]>()
  for (const channel of declared) {
    const family = familyOf(channel.name)
    const list = families.get(family)
    if (list) list.push(channel)
    else families.set(family, [channel])
  }

  for (const [family, channels] of families) {
    if (channels.length < 2) continue
    const expectedGate = dominant(channels.map((channel) => channel.gate))
    const expectedRequires = dominant(channels.map((channel) => channel.requires))
    for (const channel of channels) {
      const deviations: string[] = []
      if (channel.gate !== expectedGate) {
        deviations.push(`gate '${channel.gate}' (family uses '${expectedGate}')`)
      }
      if (channel.requires !== expectedRequires) {
        const shown = channel.requires === '' ? 'no requires' : `requires '${channel.requires}'`
        const expected = expectedRequires === '' ? 'no requires' : `'${expectedRequires}'`
        deviations.push(`${shown} (family uses ${expected})`)
      }
      if (deviations.length === 0) continue
      if (channel.deviationReason === null) {
        failures.push(
          `${relative(ROOT, IPC_SOURCE_PATH)}:${channel.line}: '${channel.name}' departs from the ` +
            `${family}: family — ${deviations.join(', ')}. If deliberate, give it a ` +
            '`deviationReason` stating why.'
        )
      } else if (channel.deviationReason === '') {
        failures.push(
          `${relative(ROOT, IPC_SOURCE_PATH)}:${channel.line}: '${channel.name}' has an empty ` +
            '`deviationReason` — state why the deviation is correct.'
        )
      }
    }
  }

  if (failures.length > 0) {
    console.error('Desktop IPC contract audit failed:\n')
    for (const failure of failures) console.error(`  ✗ ${failure}`)
    console.error(`\n${failures.length} problem(s).`)
    process.exit(1)
  }

  const exempt = declared.filter((channel) => channel.deviationReason !== null).length
  console.log(
    `Desktop IPC contract audit passed: ${declared.length} channels across ${families.size} ` +
      `families, ${exempt} acknowledged deviation(s).`
  )
}

await main()
