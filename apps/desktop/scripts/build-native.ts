import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createLogger } from '@sim/logger'

const logger = createLogger('DesktopNativeBuild')
if (process.platform !== 'darwin' && process.platform !== 'linux') {
  throw new Error('Native desktop modules require macOS or Linux.')
}
const nodeExecutable = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
const includeDirectory = join(dirname(nodeExecutable), '..', 'include', 'node')
if (!existsSync(join(includeDirectory, 'node_api.h'))) {
  throw new Error(`Could not find Node-API headers in ${includeDirectory}`)
}
const outputDirectory = 'dist/native'
mkdirSync(outputDirectory, { recursive: true })
const modules = [
  { name: 'directory', source: 'native/directory.cc', appKit: false },
  ...(process.platform === 'darwin'
    ? [{ name: 'help-search', source: 'native/help-search.mm', appKit: true }]
    : []),
]
for (const module of modules) {
  const output = join(outputDirectory, `${module.name}.node`)
  if (
    existsSync(output) &&
    statSync(output).mtimeMs >=
      Math.max(statSync(module.source).mtimeMs, statSync(import.meta.filename).mtimeMs)
  )
    continue
  const macOS = process.platform === 'darwin'
  execFileSync(
    macOS ? 'xcrun' : 'c++',
    [
      ...(macOS ? ['clang++'] : []),
      '-std=c++17',
      '-DNAPI_VERSION=8',
      ...(macOS
        ? [
            '-bundle',
            '-undefined',
            'dynamic_lookup',
            '-mmacosx-version-min=12.0',
            '-arch',
            'arm64',
            '-arch',
            'x86_64',
          ]
        : ['-shared', '-fPIC']),
      '-I',
      includeDirectory,
      ...(module.appKit
        ? ['-fobjc-arc', '-fblocks', '-framework', 'AppKit', '-framework', 'Foundation']
        : []),
      '-o',
      output,
      module.source,
    ],
    { stdio: 'inherit' }
  )
  logger.info('Compiled native desktop module', { module: module.name })
}
