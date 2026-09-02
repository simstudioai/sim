'use strict'

const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const EXPECTED_NODE_MAJOR = 24
const EXPECTED_ORACLEDB_VERSION = '7.0.1'
const EXPECTED_SOURCE_HASHES = Object.freeze({
  'lib/thin/sqlnet/networkSession.js':
    '6ec8bfae34e7c5f3ee73015327bdb61f40f23223f421f821723049ed62a0e2e9',
  'lib/thin/sqlnet/ntTcp.js': 'e7003132a75a606c6d865dff06749417f6fa0c99a77dea84b00563cc5d09171a',
})

function fail(message) {
  throw new Error(`Oracle Database driver verification failed: ${message}`)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function verifyOracleDbPatch() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (nodeMajor !== EXPECTED_NODE_MAJOR) {
    fail(`expected Node.js ${EXPECTED_NODE_MAJOR}, received ${process.versions.node}`)
  }

  const packageRoot = dirname(require.resolve('oracledb'))
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (packageJson.version !== EXPECTED_ORACLEDB_VERSION) {
    fail(`expected oracledb ${EXPECTED_ORACLEDB_VERSION}, received ${packageJson.version}`)
  }

  for (const [relativePath, expectedHash] of Object.entries(EXPECTED_SOURCE_HASHES)) {
    const actualHash = sha256(join(packageRoot, relativePath))
    if (actualHash !== expectedHash) {
      fail(`unexpected SHA-256 for ${relativePath}`)
    }
  }

  const oracledb = require(packageRoot)
  if (oracledb.versionString !== EXPECTED_ORACLEDB_VERSION) {
    fail(`driver reported version ${oracledb.versionString}`)
  }
  if (oracledb.thin !== true) {
    fail('driver is not running in Thin mode')
  }

  return Object.freeze({
    nodeVersion: process.versions.node,
    packageRoot,
    version: oracledb.versionString,
  })
}

if (require.main === module) {
  try {
    const result = verifyOracleDbPatch()
    process.stdout.write(
      `Verified oracledb ${result.version} on Node.js ${result.nodeVersion} at ${result.packageRoot}\n`
    )
  } catch (error) {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  EXPECTED_NODE_MAJOR,
  EXPECTED_ORACLEDB_VERSION,
  EXPECTED_SOURCE_HASHES,
  verifyOracleDbPatch,
}
