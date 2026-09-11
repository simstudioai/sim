#!/usr/bin/env bun
/**
 * Builds isolate-compatible bundles for Function globals and document libraries.
 *
 * Document libraries target browsers and register on `globalThis.__bundles`.
 * Function globals use neutral resolution so dependencies provide pure JavaScript
 * fallbacks instead of assuming native browser codecs. Both emit IIFEs checked
 * in so production images don't need the bundler at runtime.
 *
 * Every bundle is evaluated in a bare context before it is written: the
 * bundler can emit a reference to a runtime helper it never defines (Bun does
 * this for docx's inlined CommonJS shim), and nothing else loads these files
 * before a production document generation does.
 *
 * Run via: `bun run build:sandbox-bundles`.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { build } from 'esbuild'
import {
  evaluateFunctionGlobals,
  evaluateSandboxBundle,
} from '@/lib/execution/sandbox/bundles/verify'
import type { SandboxBundleName } from '@/lib/execution/sandbox/types'

const logger = createLogger('SandboxBundleBuild')

interface BunBuildResult {
  success: boolean
  logs: unknown[]
  outputs: Array<{ text: () => Promise<string> }>
}
interface BunBuildOptions {
  entrypoints: string[]
  target: string
  format: string
  minify: boolean
  sourcemap: string
  root: string
}
declare const Bun: { build: (opts: BunBuildOptions) => Promise<BunBuildResult> }

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLES_DIR = HERE
const ENTRIES_DIR = join(HERE, '.entries')
const APP_SIM_ROOT = join(HERE, '..', '..', '..', '..')

interface BundleSpec {
  /** Bundle identity; document libraries register on `globalThis.__bundles`. */
  name: SandboxBundleName | 'function-globals'
  /** Short filename written under `bundles/<file>.cjs`. */
  outFile: string
  /** Source of the entry file to bundle. */
  entry: string
}

const POLYFILLS_PATH = join(HERE, '_polyfills.ts')
const POLYFILL_PRELUDE = `
// Isolate-side polyfills must execute BEFORE any other import (process/browser
// captures setTimeout at module-init time). Keep this as the first import.
import '${POLYFILLS_PATH}'
import { Buffer as __BufferPolyfill } from 'buffer'
import * as __processPolyfill from 'process/browser'
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = __BufferPolyfill
if (typeof globalThis.process === 'undefined') globalThis.process = __processPolyfill
`

const BUNDLES: ReadonlyArray<BundleSpec> = [
  {
    name: 'function-globals',
    outFile: 'function-globals.cjs',
    entry: `
import { Buffer } from 'buffer/'
import { TextEncoder, TextDecoder } from '@exodus/bytes/encoding.js'
import atob from 'core-js-pure/actual/atob'
import btoa from 'core-js-pure/actual/btoa'
Object.assign(globalThis, { Buffer, TextEncoder, TextDecoder, atob, btoa })
`,
  },
  {
    name: 'pdf-lib',
    outFile: 'pdf-lib.cjs',
    entry: `
${POLYFILL_PRELUDE}
import * as mod from 'pdf-lib'
globalThis.__bundles = globalThis.__bundles || {}
globalThis.__bundles['pdf-lib'] = mod
`,
  },
  {
    name: 'docx',
    outFile: 'docx.cjs',
    entry: `
${POLYFILL_PRELUDE}
import * as mod from 'docx'
globalThis.__bundles = globalThis.__bundles || {}
globalThis.__bundles['docx'] = mod
`,
  },
  {
    name: 'pptxgenjs',
    outFile: 'pptxgenjs.cjs',
    entry: `
${POLYFILL_PRELUDE}
import PptxGenJS from 'pptxgenjs'
globalThis.__bundles = globalThis.__bundles || {}
globalThis.__bundles['pptxgenjs'] = PptxGenJS
`,
  },
]

async function main(): Promise<void> {
  rmSync(ENTRIES_DIR, { recursive: true, force: true })
  mkdirSync(ENTRIES_DIR, { recursive: true })
  mkdirSync(BUNDLES_DIR, { recursive: true })

  for (const spec of BUNDLES) {
    const entryPath = join(ENTRIES_DIR, `${spec.name}.entry.ts`)
    writeFileSync(entryPath, spec.entry, 'utf-8')

    let code: string
    if (spec.name === 'function-globals') {
      const result = await build({
        entryPoints: [entryPath],
        platform: 'neutral',
        mainFields: ['module', 'main'],
        format: 'iife',
        bundle: true,
        minify: true,
        write: false,
        legalComments: 'eof',
      })
      if (result.outputFiles.length !== 1) {
        throw new Error('Expected one Function globals bundle')
      }
      code = result.outputFiles[0].text
    } else {
      const result = await Bun.build({
        entrypoints: [entryPath],
        target: 'browser',
        format: 'iife',
        minify: true,
        sourcemap: 'none',
        root: APP_SIM_ROOT,
      })

      if (!result.success) {
        for (const log of result.logs) {
          logger.error(String(log))
        }
        throw new Error(`Failed to build sandbox bundle: ${spec.name}`)
      }
      if (result.outputs.length === 0) {
        throw new Error(`No output produced for sandbox bundle: ${spec.name}`)
      }
      code = await result.outputs[0].text()
    }

    const banner = `/**\n * Sandbox bundle: ${spec.name}\n * Generated by apps/sim/lib/execution/sandbox/bundles/build.ts.\n * Do not edit by hand. Run \`bun run build:sandbox-bundles\` to regenerate.\n */\n`
    const output = banner + code
    try {
      if (spec.name === 'function-globals') {
        evaluateFunctionGlobals(output)
      } else {
        evaluateSandboxBundle(output, spec.name)
      }
    } catch (error) {
      throw new Error(
        `Sandbox bundle ${spec.name} does not evaluate in a bare isolate context: ${String(error)}`
      )
    }
    writeFileSync(join(BUNDLES_DIR, spec.outFile), output, 'utf-8')
    logger.info(`built and verified ${spec.outFile} (${code.length.toLocaleString()} chars)`)
  }

  rmSync(ENTRIES_DIR, { recursive: true, force: true })
}

main().catch((err) => {
  logger.error('sandbox bundle build failed', err)
  process.exit(1)
})
