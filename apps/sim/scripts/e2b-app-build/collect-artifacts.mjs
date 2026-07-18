import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'

const MAX_FILES = 500
const MAX_FILE_BYTES = 5_000_000
const MAX_TOTAL_BYTES = 20_000_000
const ALLOWED_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.css',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.woff',
  '.woff2',
  '.json',
  '.ico',
])

const [distArg, outputArg] = process.argv.slice(2)
if (!distArg || !outputArg) {
  throw new Error('Usage: collect-artifacts.mjs <dist-dir> <output-json>')
}

const distRoot = await realpath(resolve(distArg))
const files = []
let totalBytes = 0

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const absolute = resolve(dir, entry.name)
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink()) {
      throw new Error(`Build output contains a symbolic link: ${entry.name}`)
    }
    const real = await realpath(absolute)
    if (real !== distRoot && !real.startsWith(distRoot + sep)) {
      throw new Error(`Build output escapes dist root: ${entry.name}`)
    }

    if (stat.isDirectory()) {
      await walk(real)
      continue
    }
    if (!stat.isFile()) {
      throw new Error(`Unsupported build output entry: ${entry.name}`)
    }

    const path = relative(distRoot, real).split(sep).join('/')
    if (path.endsWith('.map')) continue
    const extension = extname(path).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error(`Disallowed build output extension: ${path}`)
    }

    if (files.length >= MAX_FILES) {
      throw new Error(`Build output exceeds ${MAX_FILES} files`)
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`Build output file exceeds ${MAX_FILE_BYTES} bytes: ${path}`)
    }
    totalBytes += stat.size
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`Build output exceeds ${MAX_TOTAL_BYTES} bytes`)
    }

    const content = await readFile(real)
    files.push({ path, contentBase64: content.toString('base64') })
  }
}

await walk(distRoot)
if (!files.some((file) => file.path === 'index.html')) {
  throw new Error('Build output is missing index.html')
}

await writeFile(
  resolve(outputArg),
  JSON.stringify({
    version: 1,
    fileCount: files.length,
    totalBytes,
    files,
  }),
  'utf8'
)
