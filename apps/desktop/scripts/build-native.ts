import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  nodeIncludeDirectory,
  recordNativeBuild,
  reuseNativeBuild,
} from '@desktop-scripts/native-build-cache'
import { createLogger } from '@sim/logger'

const logger = createLogger('DesktopNativeBuild')
const args = process.argv.slice(2)
if (args.some((argument) => argument !== '--computer-use') || args.length > 1) {
  throw new Error('Usage: bun run scripts/build-native.ts [--computer-use]')
}
if (process.platform !== 'darwin' && process.platform !== 'linux') {
  throw new Error('Native desktop modules require macOS or Linux.')
}
const includeDirectory = nodeIncludeDirectory()
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
  const macOS = process.platform === 'darwin'
  const outputs = [{ path: output, executable: true }]
  if (reuseNativeBuild(module.name, outputs)) {
    try {
      if (macOS) {
        execFileSync('xcrun', ['lipo', output, '-verify_arch', 'arm64', 'x86_64'])
      }
      continue
    } catch {
      logger.warn('Rebuilding native module with invalid cached architectures', {
        module: module.name,
      })
    }
  }
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
  recordNativeBuild(module.name, outputs)
  logger.info('Compiled native desktop module', { module: module.name })
}

/** Bundle the native helper; packaged builds sign it with the desktop distribution identity. */
function compileComputerUse(): void {
  if (process.platform !== 'darwin') return
  const bundle = 'dist/native/Sim Computer Use.app'
  const binaryDirectory = join(bundle, 'Contents', 'MacOS')
  const binary = join(binaryDirectory, 'SimComputerUse')
  const outputs = [
    { path: binary, executable: true },
    { path: join(bundle, 'Contents', 'Info.plist') },
    { path: join(bundle, 'Contents', '_CodeSignature', 'CodeResources') },
  ]
  if (reuseNativeBuild('computer-use', outputs)) {
    try {
      execFileSync('xcrun', ['lipo', binary, '-verify_arch', 'arm64', 'x86_64'])
      execFileSync('codesign', ['--verify', '--strict', bundle])
      return
    } catch {
      rmSync(bundle, { recursive: true, force: true })
    }
  }
  rmSync(bundle, { recursive: true, force: true })
  mkdirSync(binaryDirectory, { recursive: true })
  cpSync('native/computer-use/Info.plist', join(bundle, 'Contents', 'Info.plist'))
  const parts: string[] = []
  for (const arch of ['arm64', 'x86_64']) {
    const output = join('dist/native', `computer-use-${arch}`)
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-parse-as-library',
        '-O',
        '-target',
        `${arch}-apple-macosx14.0`,
        'native/computer-use/ComputerUse.swift',
        '-o',
        output,
      ],
      { stdio: 'inherit' }
    )
    parts.push(output)
  }
  execFileSync('xcrun', ['lipo', '-create', ...parts, '-output', binary], { stdio: 'inherit' })
  for (const part of parts) rmSync(part)
  execFileSync('codesign', ['--force', '--sign', '-', bundle], { stdio: 'inherit' })
  recordNativeBuild('computer-use', outputs)
  logger.info('Compiled native macOS Computer Use helper')
}

if (args.includes('--computer-use')) compileComputerUse()
