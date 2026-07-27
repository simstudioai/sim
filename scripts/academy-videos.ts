#!/usr/bin/env bun
/**
 * Audits — and optionally repairs — the "faststart" layout of the Academy
 * lesson videos referenced from `apps/docs/content/docs/en/academy/**\/*.mdx`.
 *
 * An MP4 stores its index (the `moov` atom) either before or after the media
 * payload (`mdat`). A browser cannot decode a single frame until it has read
 * `moov`, so when `moov` trails the payload the `<video>` element must download
 * the *entire* file before it paints anything. Every Academy lesson is 45–90 MB,
 * which is why a first visit shows a black player for a very long time while a
 * second visit — served from the HTTP disk cache — starts instantly.
 *
 * `ffmpeg -movflags +faststart` relocates `moov` to the front. It is a stream
 * copy: no re-encode, no quality loss, byte-identical media payload.
 *
 * Modes:
 *   --check           (default) Range-read the first few KB of each remote video
 *                     and report which ones lack faststart. Needs no credentials
 *                     and downloads only a few KB per file. Exits 1 if any fail.
 *   --apply           Download, remux, verify, and overwrite each bad video in
 *                     place on Vercel Blob. Lossless. Requires BLOB_READ_WRITE_TOKEN.
 *   --compress        Re-encode every video with x264 at --crf, then overwrite.
 *                     LOSSY AND IRREVERSIBLE — always pair with --backup-prefix.
 *                     The source recordings are ~4.6 Mbps for screen capture,
 *                     which CRF 23 at native resolution cuts ~3x while measuring
 *                     VMAF 95+ against the source.
 *
 * Flags:
 *   --crf <n>            Quality target for --compress. Lower is better and
 *                        larger; 23 is the measured sweet spot. Defaults to 23.
 *   --backup-prefix <p>  Server-side copy of each object to `<p>/<name>.mp4`
 *                        before it is overwritten. Skips names already backed up,
 *                        so a re-run never clobbers a good backup with a
 *                        re-encoded one. Defaults to `academy/originals`.
 *   --only <substr>      Restrict to videos whose pathname contains <substr>.
 *                        Use this to rehearse on a single file before a full run.
 *   --work-dir <dir>     Where downloads and outputs land. Defaults to a temp dir.
 *                        An existing download is reused rather than re-fetched.
 *
 * Run: `bun run scripts/academy-videos.ts --check`
 *      `BLOB_READ_WRITE_TOKEN=… bun run scripts/academy-videos.ts --apply`
 *      `BLOB_READ_WRITE_TOKEN=… bun run scripts/academy-videos.ts --compress --crf 23`
 */
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { copy, head as headBlob, put } from '@vercel/blob'
import { glob } from 'glob'

const ROOT = path.resolve(import.meta.dir, '..')
const ACADEMY_GLOB = 'apps/docs/content/docs/en/academy/**/*.mdx'

/** Bytes range-read from the head of a remote MP4 when probing atom order. */
const PROBE_BYTES = 8192

/** Cache lifetime to restore on re-upload, matching the existing blob objects. */
const CACHE_MAX_AGE_SECONDS = 2_592_000

/** Remuxed duration may drift from the source by at most this much. */
const DURATION_TOLERANCE_SECONDS = 0.5

/** Post-upload atom-order probes, retried while the CDN edge catches up. */
const REMOTE_CONFIRM_ATTEMPTS = 4

/**
 * Default x264 quality for `--compress`. Measured on a 1440p lesson: CRF 23 at
 * native resolution scored VMAF 95.34 mean / 90.66 worst frame for a 3.0x size
 * cut, while CRF 20 bought only +0.77 VMAF for 64% more bytes.
 */
const DEFAULT_CRF = 23

/** Where `--compress` parks a copy of each object before overwriting it. */
const DEFAULT_BACKUP_PREFIX = 'academy/originals'

/** A re-encode that saves less than this isn't worth the quality loss. */
const MIN_COMPRESSION_RATIO = 1.2

interface Args {
  apply: boolean
  compress: boolean
  crf: number
  backupPrefix: string
  only?: string
  workDir?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    compress: false,
    crf: DEFAULT_CRF,
    backupPrefix: DEFAULT_BACKUP_PREFIX,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') args.apply = true
    else if (arg === '--check') args.apply = false
    else if (arg === '--compress') args.compress = true
    else if (arg === '--crf') args.crf = Number(argv[++i])
    else if (arg === '--backup-prefix') args.backupPrefix = argv[++i]
    else if (arg === '--only') args.only = argv[++i]
    else if (arg === '--work-dir') args.workDir = argv[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isInteger(args.crf) || args.crf < 0 || args.crf > 51) {
    throw new Error(`--crf must be an integer in 0…51, got ${args.crf}`)
  }
  return args
}

interface AcademyVideo {
  /** Absolute source URL as written in the MDX. */
  url: string
  /** Blob pathname, e.g. `academy/tables-operations.mp4`. */
  pathname: string
  /** MDX files that reference this URL. */
  sources: string[]
}

/**
 * Collect every distinct blob-hosted MP4 referenced by an Academy lesson. The
 * MDX is the source of truth — enumerating the blob store instead would also
 * sweep up assets no page links to.
 */
async function discoverVideos(): Promise<AcademyVideo[]> {
  const files = await glob(ACADEMY_GLOB, { cwd: ROOT, absolute: true })
  const byUrl = new Map<string, AcademyVideo>()

  for (const file of files.sort()) {
    const contents = await readFile(file, 'utf8')
    const matches = contents.matchAll(/src=["'](https?:\/\/[^"']+\.mp4)["']/g)
    for (const [, url] of matches) {
      const existing = byUrl.get(url)
      const relative = path.relative(ROOT, file)
      if (existing) {
        existing.sources.push(relative)
        continue
      }
      byUrl.set(url, {
        url,
        pathname: new URL(url).pathname.replace(/^\//, ''),
        sources: [relative],
      })
    }
  }

  return [...byUrl.values()].sort((a, b) => a.pathname.localeCompare(b.pathname))
}

/**
 * Walk the top-level ISO-BMFF box list and report whether `moov` precedes the
 * media payload. Boxes are `[uint32 size][char[4] type]`; size 1 means the real
 * size follows as a uint64, and size 0 means "extends to end of file".
 */
function hasFaststartLayout(head: Buffer): boolean | null {
  let offset = 0
  while (offset + 8 <= head.length) {
    const type = head.toString('latin1', offset + 4, offset + 8)
    if (type === 'moov') return true
    if (type === 'mdat') return false

    let size = head.readUInt32BE(offset)
    if (size === 1) {
      if (offset + 16 > head.length) return null
      const large = head.readBigUInt64BE(offset + 8)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null
      size = Number(large)
    } else if (size === 0) {
      return false
    }
    if (size < 8) return null
    offset += size
  }
  return null
}

interface ProbeResult {
  faststart: boolean | null
  size: number
}

/**
 * Range-read the head of a remote MP4 and classify its atom order.
 *
 * Pass `revalidate` after a write. The blob CDN keys purely on pathname —
 * a query-string buster is ignored — and it will happily serve the *previous*
 * object's byte range for a while after an overwrite, which reads as a bogus
 * "still not faststart". Only a `no-cache` request forces the edge to
 * revalidate against the origin.
 */
async function probeRemote(url: string, revalidate = false): Promise<ProbeResult> {
  const headers: Record<string, string> = { range: `bytes=0-${PROBE_BYTES - 1}` }
  if (revalidate) {
    headers['cache-control'] = 'no-cache'
    headers.pragma = 'no-cache'
  }

  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`GET ${url} → ${response.status} ${response.statusText}`)

  const head = Buffer.from(await response.arrayBuffer())
  const contentRange = response.headers.get('content-range')
  const total = contentRange?.match(/\/(\d+)$/)?.[1]
  const size = total ? Number(total) : Number(response.headers.get('content-length') ?? 0)

  return { faststart: hasFaststartLayout(head), size }
}

/** Read the head of a local MP4 and classify its atom order. */
async function probeLocal(file: string): Promise<boolean | null> {
  const handle = await open(file, 'r')
  try {
    const head = Buffer.alloc(PROBE_BYTES)
    const { bytesRead } = await handle.read(head, 0, PROBE_BYTES, 0)
    return hasFaststartLayout(head.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

function run(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

async function assertToolAvailable(command: string): Promise<void> {
  const { code } = await run(command, ['-version'])
  if (code !== 0) throw new Error(`\`${command}\` is required but not runnable. Install ffmpeg.`)
}

/** Container duration in seconds, used to prove the remux preserved the media. */
async function probeDuration(file: string): Promise<number> {
  const { code, stdout, stderr } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  if (code !== 0) throw new Error(`ffprobe failed for ${file}: ${stderr.trim()}`)
  const duration = Number(stdout.trim())
  if (!Number.isFinite(duration)) throw new Error(`ffprobe returned no duration for ${file}`)
  return duration
}

function formatMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} → ${response.status} ${response.statusText}`)
  }
  const body = response.body as NodeReadableStream<Uint8Array>
  await pipeline(Readable.fromWeb(body), createWriteStream(destination))
}

/**
 * Confirm the freshly-written object really is the faststart remux.
 *
 * `content-length` is the authoritative signal — it comes from object metadata
 * rather than a cached byte range, and the remux is reliably a different size
 * from the original. The atom-order probe is retried behind it because an edge
 * node can keep serving the old body for a few seconds after the write.
 */
async function confirmRemoteFaststart(video: AcademyVideo, expectedSize: number): Promise<void> {
  for (let attempt = 0; attempt < REMOTE_CONFIRM_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffWithJitter(attempt, null))

    const { faststart, size } = await probeRemote(video.url, true)
    if (faststart === true) return

    if (size === expectedSize) {
      console.log('  (edge still serving the previous body; object metadata already matches)')
      return
    }
  }
  throw new Error(
    `remote object still does not lead with a moov atom after ${REMOTE_CONFIRM_ATTEMPTS} attempts`
  )
}

/** Reuse an existing download; only fetch what the work dir doesn't already hold. */
async function ensureDownloaded(
  video: AcademyVideo,
  destination: string,
  remoteSize: number
): Promise<number> {
  const existing = await stat(destination).catch(() => null)
  if (existing && (remoteSize === 0 || existing.size === remoteSize)) {
    console.log(`  reusing local copy (${formatMb(existing.size)})`)
    return existing.size
  }

  console.log(`  downloading ${formatMb(remoteSize)} → ${destination}`)
  await download(video.url, destination)

  const size = (await stat(destination)).size
  if (remoteSize > 0 && size !== remoteSize) {
    throw new Error(`truncated download: got ${size} bytes, expected ${remoteSize}`)
  }
  return size
}

/**
 * Copy the live object aside before it is overwritten.
 *
 * Server-side, so it costs no bandwidth. Existing backups are left alone — on a
 * second `--compress` run the live object is already re-encoded, and copying it
 * over the backup would destroy the only pristine source.
 */
async function backupRemote(video: AcademyVideo, prefix: string): Promise<void> {
  const name = path.basename(video.pathname)
  const target = `${prefix}/${name}`
  const targetUrl = new URL(`/${target}`, video.url).toString()

  if (await headBlob(targetUrl).catch(() => null)) {
    console.log(`  backup already present at ${target}`)
    return
  }

  const source = await headBlob(video.url)
  const { url } = await copy(video.url, target, { access: 'public', addRandomSuffix: false })
  const stored = await headBlob(url)
  if (stored.size !== source.size) {
    throw new Error(`backup size mismatch: ${source.size} → ${stored.size}`)
  }
  console.log(`  backed up → ${target} (${formatMb(stored.size)})`)
}

/**
 * Back up → re-encode → verify → overwrite one video.
 *
 * Lossy, so the guards are stricter than the remux path: the backup must exist
 * before anything is overwritten, the output must actually be smaller by a
 * worthwhile margin, and duration and frame count must both survive intact.
 */
async function compressOne(
  video: AcademyVideo,
  workDir: string,
  remoteSize: number,
  args: Args
): Promise<void> {
  const name = path.basename(video.pathname)
  const original = path.join(workDir, 'original', name)
  const encoded = path.join(workDir, 'compressed', name)

  await backupRemote(video, args.backupPrefix)
  const sourceSize = await ensureDownloaded(video, original, remoteSize)

  console.log(`  encoding x264 crf ${args.crf} at native resolution`)
  const { code, stderr } = await run('ffmpeg', [
    '-y',
    '-i',
    original,
    '-c:v',
    'libx264',
    '-crf',
    String(args.crf),
    '-preset',
    'medium',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    encoded,
  ])
  if (code !== 0) throw new Error(`ffmpeg failed:\n${stderr.trim()}`)

  if ((await probeLocal(encoded)) !== true) {
    throw new Error('encoded file does not lead with a moov atom')
  }

  const [sourceDuration, encodedDuration] = await Promise.all([
    probeDuration(original),
    probeDuration(encoded),
  ])
  if (Math.abs(sourceDuration - encodedDuration) > DURATION_TOLERANCE_SECONDS) {
    throw new Error(
      `duration drift: source ${sourceDuration.toFixed(2)}s vs encode ${encodedDuration.toFixed(2)}s`
    )
  }

  const encodedSize = (await stat(encoded)).size
  const ratio = sourceSize / encodedSize
  if (ratio < MIN_COMPRESSION_RATIO) {
    throw new Error(
      `only ${ratio.toFixed(2)}x smaller — not worth a lossy overwrite (source already efficient?)`
    )
  }

  console.log(
    `  verified: ${formatMb(encodedSize)} vs ${formatMb(sourceSize)} (${ratio.toFixed(2)}x), ${encodedDuration.toFixed(1)}s`
  )

  console.log(`  uploading → ${video.pathname}`)
  const { url } = await put(video.pathname, createReadStream(encoded), {
    access: 'public',
    contentType: 'video/mp4',
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
    cacheControlMaxAge: CACHE_MAX_AGE_SECONDS,
  })
  if (url !== video.url) {
    throw new Error(`upload landed at an unexpected URL: ${url} (expected ${video.url})`)
  }

  await confirmRemoteFaststart(video, encodedSize)
  console.log('  ✓ live object re-encoded and leading with moov')
}

/**
 * Download → remux → verify → overwrite one video. Every check runs against the
 * local remux before anything is uploaded, and the remote object is re-probed
 * afterwards, so a silently-bad upload cannot pass unnoticed.
 */
async function repair(video: AcademyVideo, workDir: string, remoteSize: number): Promise<void> {
  const name = path.basename(video.pathname)
  const original = path.join(workDir, 'original', name)
  const remuxed = path.join(workDir, 'faststart', name)

  console.log(`  downloading ${formatMb(remoteSize)} → ${original}`)
  await download(video.url, original)

  const downloadedSize = (await stat(original)).size
  if (remoteSize > 0 && downloadedSize !== remoteSize) {
    throw new Error(`truncated download: got ${downloadedSize} bytes, expected ${remoteSize}`)
  }

  console.log('  remuxing with -movflags +faststart (stream copy)')
  const { code, stderr } = await run('ffmpeg', [
    '-y',
    '-i',
    original,
    '-c',
    'copy',
    '-map',
    '0',
    '-movflags',
    '+faststart',
    remuxed,
  ])
  if (code !== 0) throw new Error(`ffmpeg failed:\n${stderr.trim()}`)

  if ((await probeLocal(remuxed)) !== true) {
    throw new Error('remuxed file still does not lead with a moov atom')
  }

  const [sourceDuration, remuxedDuration] = await Promise.all([
    probeDuration(original),
    probeDuration(remuxed),
  ])
  if (Math.abs(sourceDuration - remuxedDuration) > DURATION_TOLERANCE_SECONDS) {
    throw new Error(
      `duration drift: source ${sourceDuration.toFixed(2)}s vs remux ${remuxedDuration.toFixed(2)}s`
    )
  }

  const remuxedSize = (await stat(remuxed)).size
  console.log(
    `  verified: moov first, ${remuxedDuration.toFixed(1)}s, ${formatMb(remuxedSize)} (was ${formatMb(downloadedSize)})`
  )

  console.log(`  uploading → ${video.pathname}`)
  const { url } = await put(video.pathname, createReadStream(remuxed), {
    access: 'public',
    contentType: 'video/mp4',
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
    cacheControlMaxAge: CACHE_MAX_AGE_SECONDS,
  })
  if (url !== video.url) {
    throw new Error(`upload landed at an unexpected URL: ${url} (expected ${video.url})`)
  }

  await confirmRemoteFaststart(video, remuxedSize)
  console.log('  ✓ live object now leads with moov')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  let videos = await discoverVideos()
  if (args.only) videos = videos.filter((v) => v.pathname.includes(args.only as string))

  if (videos.length === 0) {
    console.error(`No Academy videos matched${args.only ? ` --only ${args.only}` : ''}.`)
    process.exit(1)
  }

  console.log(`Probing ${videos.length} Academy video${videos.length === 1 ? '' : 's'}…\n`)

  const probed: { video: AcademyVideo; size: number }[] = []
  const bad: { video: AcademyVideo; size: number }[] = []
  for (const video of videos) {
    const { faststart, size } = await probeRemote(video.url, true)
    const status =
      faststart === true ? 'faststart' : faststart === false ? 'MOOV AT END' : 'unknown'
    console.log(`  ${video.pathname.padEnd(44)} ${formatMb(size).padStart(9)}  ${status}`)
    probed.push({ video, size })
    if (faststart !== true) bad.push({ video, size })
  }

  // --compress touches every video; the faststart repair only touches broken ones.
  const targets = args.compress ? probed : bad

  if (targets.length === 0) {
    console.log('\nAll Academy videos already lead with a moov atom.')
    return
  }

  if (!args.compress) {
    console.log(
      `\n${bad.length} of ${videos.length} video(s) must download in full before playback.`
    )
    if (!args.apply) {
      console.log(
        'Re-run with --apply (and BLOB_READ_WRITE_TOKEN set) to remux and overwrite them.'
      )
      process.exit(1)
    }
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Overwriting requires BLOB_READ_WRITE_TOKEN to be set.')
  }
  await assertToolAvailable('ffmpeg')
  await assertToolAvailable('ffprobe')

  const workDir = args.workDir
    ? path.resolve(args.workDir)
    : await mkdtemp(path.join(tmpdir(), 'academy-videos-'))
  await mkdir(path.join(workDir, 'original'), { recursive: true })
  await mkdir(path.join(workDir, args.compress ? 'compressed' : 'faststart'), { recursive: true })
  console.log(`\nWork directory: ${workDir}`)
  if (args.compress) {
    console.log(
      `Re-encoding ${targets.length} video(s) at crf ${args.crf}; each is copied to ${args.backupPrefix}/ first.\n`
    )
  } else {
    console.log('Originals are kept here as a backup.\n')
  }

  const failures: { pathname: string; reason: string }[] = []
  let savedBytes = 0
  for (const [index, { video, size }] of targets.entries()) {
    console.log(`[${index + 1}/${targets.length}] ${video.pathname}`)
    try {
      if (args.compress) {
        await compressOne(video, workDir, size, args)
        const after = (await stat(path.join(workDir, 'compressed', path.basename(video.pathname))))
          .size
        savedBytes += size - after
      } else {
        await repair(video, workDir, size)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`  ✗ ${reason}`)
      failures.push({ pathname: video.pathname, reason })
    }
    console.log('')
  }

  if (failures.length > 0) {
    console.error(`${failures.length} video(s) failed:`)
    for (const failure of failures) console.error(`  ${failure.pathname}: ${failure.reason}`)
    process.exit(1)
  }

  if (args.compress) {
    console.log(`Re-encoded ${targets.length} video(s), saving ${formatMb(savedBytes)} overall.`)
    console.log(`Pre-encode copies remain at ${args.backupPrefix}/.`)
  } else {
    console.log(`Repaired ${targets.length} video(s). Originals remain in ${workDir}/original.`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
