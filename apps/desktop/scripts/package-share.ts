/**
 * Share build: packages distributable .dmg/.zip artifacts from the current
 * checkout, signed with whatever identity is on the machine (no notarization,
 * no trusted timestamps) — the "send someone a build to try" loop.
 *
 *   bun run package:share                    # production only
 *   bun run package:share --all              # all four channels
 *   bun run package:share --staging --dev    # just these two
 *   bun run package:share --dir              # skip dmg/zip, package the .app only (fast)
 *   SIM_DESKTOP_DEFAULT_ORIGIN=https://sim.acme.example bun run package:share
 *
 * Each channel lands in release/<slug>/ with artifacts named for it — sim,
 * sim-staging, sim-dev, sim-local. electron-builder.yml's artifactName is a
 * single literal ("Sim-${version}-${arch}"), so without the override every
 * channel writes the same filename and the last build silently wins. Only this
 * path overrides it: the release workflow publishes one channel per GitHub
 * release, where the flat name is what electron-updater expects.
 *
 * The baked origin decides the bundle identity, exactly as it decides the
 * runtime one. This used to shell straight into electron-builder, which took
 * productName/appId from electron-builder.yml — always the production pair — so
 * a dev-pointed share packaged as "Sim.app" with the production bundle id while
 * naming itself "Sim Dev" at runtime.
 *
 * Channels build ONE AT A TIME on purpose. scripts/build.ts writes the bundle
 * to dist/ and the app icon to build/generated-icon.icns, both fixed paths, so
 * concurrent channels would overwrite each other's bundle mid-package and ship
 * a dmg whose baked origin belongs to a different environment — invisible until
 * someone signs in. Giving each channel its own bundle directory is what would
 * make concurrency safe, and the flag that redirects the app entry point
 * (-c.extraMetadata.main) rewrites this package.json IN THE SOURCE TREE,
 * stripping scripts and devDependencies. If parallelism is worth it later, the
 * way to get it is a per-channel project directory (electron-builder --project)
 * — not extraMetadata.
 */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { ALL_CHANNELS, type ChannelIdentity, identityForOrigin } from './channels'

const FLAG_TO_CHANNEL: Record<string, ChannelIdentity> = Object.fromEntries(
  ALL_CHANNELS.map((channel) => [
    `--${channel.slug.replace(/^sim-/, '').replace(/^sim$/, 'prod')}`,
    channel,
  ])
)

const args = process.argv.slice(2)
const dirOnly = args.includes('--dir')
const bakedOriginOverride = process.env.SIM_DESKTOP_DEFAULT_ORIGIN ?? ''

function selectedChannels(): ChannelIdentity[] {
  if (args.includes('--all')) return [...ALL_CHANNELS]
  const picked = args.filter((arg) => arg in FLAG_TO_CHANNEL).map((arg) => FLAG_TO_CHANNEL[arg])
  if (picked.length > 0) return picked
  // No channel flags: honour an explicit origin (self-hosted shares resolve to
  // the production identity), otherwise plain production.
  return [identityForOrigin(bakedOriginOverride)]
}

const channels = selectedChannels()
// An explicit origin only makes sense for a single-channel run; with several
// channels each one supplies its own.
const originFor = (channel: ChannelIdentity): string =>
  channels.length === 1 && bakedOriginOverride ? bakedOriginOverride : channel.origin

function run(command: string, commandArgs: string[], env?: Record<string, string>): void {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
  if (result.status !== 0) {
    console.error(`\n✖ ${command} ${commandArgs.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
}

function buildChannel(channel: ChannelIdentity): void {
  const origin = originFor(channel)
  console.log(`\n• ${channel.slug}: ${channel.name} (${channel.appId}) → ${origin}`)

  // electron-builder only writes the output dir for the CURRENT target/arch, so
  // an app left by an earlier run with different settings would survive
  // alongside the new one.
  for (const dir of ['mac-universal', 'mac-arm64', 'mac']) {
    rmSync(`release/${channel.slug}/${dir}`, { recursive: true, force: true })
  }
  // electron-builder's `files: dist/**` packages whatever is in dist/, not just
  // what this build wrote. Anything left there by an earlier run — another
  // channel's bundle, scratch from an experiment — rides along inside the dmg,
  // so a production artifact can end up carrying a dev-pointed bundle. Dead
  // weight rather than a live risk (the app boots package.json's `main`), but
  // not something to hand to anyone. build.ts rewrites the directory on the
  // next line.
  rmSync('dist', { recursive: true, force: true })

  run('bun', ['run', 'scripts/build.ts'], { SIM_DESKTOP_DEFAULT_ORIGIN: origin })
  run('bunx', [
    'electron-builder',
    '--mac',
    ...(dirOnly ? ['dir'] : []),
    '--publish',
    'never',
    // Trusted timestamps make codesign do a network round trip to Apple per
    // file (hundreds inside the Electron framework). Distribution builds need
    // them; a share build does not, and it turns signing into a long stall.
    '-c.mac.timestamp=none',
    `-c.productName=${channel.name}`,
    `-c.appId=${channel.appId}`,
    `-c.directories.output=release/${channel.slug}`,
    // The ${...} placeholders are electron-builder's own templating, expanded
    // by it at packaging time — escaped here so JS leaves them alone.
    `-c.artifactName=${channel.slug}-\${version}-\${arch}.\${ext}`,
  ])
  console.log(`✔ ${channel.slug}: release/${channel.slug}/`)
}

// Shared node_modules state, and the one step every channel has in common.
run('bun', ['run', 'scripts/ensure-pty-prebuilds.ts'])
console.log(
  `• Building ${channels.length} channel(s)${dirOnly ? ' (dir only)' : ''}: ${channels.map((c) => c.slug).join(', ')}`
)
for (const channel of channels) {
  buildChannel(channel)
}
