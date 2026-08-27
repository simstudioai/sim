#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildInstallerArguments } from './arguments'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(currentDirectory, '..')
const require = createRequire(import.meta.url)
const installerPackage = require.resolve('skills/package.json')
const installerCli = resolve(dirname(installerPackage), 'bin/cli.mjs')
const installerArguments = buildInstallerArguments(pluginRoot, process.argv.slice(2))

const result = spawnSync(process.execPath, [installerCli, ...installerArguments], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

if (result.error) throw result.error
if (result.signal) throw new Error(`Skills installer terminated with signal ${result.signal}`)
if (result.status === null) throw new Error('Skills installer exited without a status code')

process.exitCode = result.status
