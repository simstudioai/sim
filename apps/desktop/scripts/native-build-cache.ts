import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'

interface NativeOutput {
  path: string
  executable?: boolean
}

const SOURCES = [
  'native/directory.cc',
  'native/help-search.mm',
  'native/computer-use/ComputerUse.swift',
  'native/computer-use/Info.plist',
  'scripts/build.ts',
  'scripts/build-native.ts',
  'scripts/native-build-cache.ts',
  'tsconfig.json',
] as const

let fingerprint: string | undefined

function command(executable: string, args: string[]): string {
  return execFileSync(executable, args, { encoding: 'utf8' }).trim()
}

/** Resolves the headers used by the compiler rather than the runtime executing Bun. */
export function nodeIncludeDirectory(): string {
  const executable = command('node', ['-p', 'process.execPath'])
  const directory = join(dirname(executable), '..', 'include', 'node')
  accessSync(join(directory, 'node_api.h'), constants.R_OK)
  return directory
}

/** Keys native outputs by all source, compiler, SDK, target and Node-header inputs. */
function nativeBuildFingerprint(): string {
  if (fingerprint) return fingerprint
  const hash = createHash('sha256')
  const add = (name: string, value: string | Buffer) => {
    hash.update(`${name}\0${value.length}\0`)
    hash.update(value)
  }
  add('platform', process.platform)
  add('architecture', process.arch)
  for (const source of SOURCES) add(source, readFileSync(source))
  const addHeaders = (directory: string, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      compareStrings(a.name, b.name)
    )) {
      const path = join(directory, entry.name)
      const name = join(prefix, entry.name)
      if (entry.isDirectory()) addHeaders(path, name)
      else if (entry.isFile()) add(name, readFileSync(path))
    }
  }
  addHeaders(nodeIncludeDirectory())
  if (process.platform === 'darwin') {
    add('os', command('sw_vers', ['-buildVersion']))
    add('developer', command('xcode-select', ['-p']))
    for (const args of [
      ['clang++', '--version'],
      ['swiftc', '--version'],
      ['--show-sdk-path'],
      ['--show-sdk-version'],
      ['--show-sdk-build-version'],
    ]) {
      add(args.join(' '), command('xcrun', args))
    }
  } else {
    add('compiler', command('c++', ['--version']))
  }
  for (const name of [
    'DEVELOPER_DIR',
    'SDKROOT',
    'MACOSX_DEPLOYMENT_TARGET',
    'CPATH',
    'CPLUS_INCLUDE_PATH',
    'TOOLCHAINS',
  ]) {
    add(name, process.env[name] ?? '')
  }
  fingerprint = hash.digest('hex')
  return fingerprint
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** A restore is reusable only when its current inputs, bytes and executable modes match. */
export function reuseNativeBuild(name: string, outputs: readonly NativeOutput[]): boolean {
  const expected = nativeBuildFingerprint()
  try {
    const manifest: unknown = JSON.parse(readFileSync(`dist/native/.${name}.json`, 'utf8'))
    if (
      !isRecordLike(manifest) ||
      manifest.fingerprint !== expected ||
      !isRecordLike(manifest.outputs)
    ) {
      return false
    }
    for (const output of outputs) {
      if (manifest.outputs[output.path] !== digest(output.path)) return false
      if (output.executable) accessSync(output.path, constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

/** Records only completed native builds; incomplete or corrupt outputs are rebuilt. */
export function recordNativeBuild(name: string, outputs: readonly NativeOutput[]): void {
  mkdirSync('dist/native', { recursive: true })
  writeFileSync(
    `dist/native/.${name}.json`,
    `${JSON.stringify({
      fingerprint: nativeBuildFingerprint(),
      outputs: Object.fromEntries(outputs.map((output) => [output.path, digest(output.path)])),
    })}\n`
  )
}

if (import.meta.main) process.stdout.write(`${nativeBuildFingerprint()}\n`)
