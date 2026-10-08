'use strict'

const assert = require('node:assert/strict')
const { readFileSync, statSync } = require('node:fs')
const http = require('node:http')
const Module = require('node:module')
const { dirname, join, resolve } = require('node:path')
const { verifyOracleDbPatch } = require('./verify-oracledb-patch.cjs')

function loadNetworkSessionTestHooks(packageRoot) {
  const sourcePath = join(packageRoot, 'lib/thin/sqlnet/networkSession.js')
  const source = readFileSync(sourcePath, 'utf8')
  const testModule = new Module(sourcePath, module)
  testModule.filename = sourcePath
  testModule.paths = Module._nodeModulePaths(dirname(sourcePath))
  testModule._compile(
    `${source}\nmodule.exports.__getRedirectParamsForTest = getRedirectParams;\n`,
    sourcePath
  )
  return testModule.exports
}

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return address.port
}

async function testProxyPrecedence(packageRoot) {
  const NTTCP = require(join(packageRoot, 'lib/thin/sqlnet/ntTcp.js'))
  let trustedHits = 0
  let addressHits = 0
  const trustedProxy = http.createServer()
  const addressProxy = http.createServer()
  const proxySockets = new Set()

  trustedProxy.on('connect', (_request, socket) => {
    trustedHits += 1
    proxySockets.add(socket)
    socket.once('close', () => proxySockets.delete(socket))
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  })
  addressProxy.on('connect', (_request, socket) => {
    addressHits += 1
    proxySockets.add(socket)
    socket.once('close', () => proxySockets.delete(socket))
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  })

  const trustedPort = await listen(trustedProxy)
  const addressPort = await listen(addressProxy)
  const adapter = new NTTCP({
    connectionId: 'oracledb-patch-self-test',
    httpsProxy: '127.0.0.1',
    httpsProxyPort: trustedPort,
  })

  try {
    await adapter.ntConnect({
      host: 'database.invalid',
      port: 1521,
      httpsProxy: '127.0.0.1',
      httpsProxyPort: addressPort,
    })
    assert.equal(trustedHits, 1)
    assert.equal(addressHits, 0)
  } finally {
    adapter.stream?.destroy()
    for (const socket of proxySockets) {
      socket.destroy()
    }
    trustedProxy.close()
    addressProxy.close()
  }
}

async function testTransportGuards(packageRoot) {
  const { NetworkSession } = require(join(packageRoot, 'lib/thin/sqlnet/networkSession.js'))

  const missingProxy = new NetworkSession()
  missingProxy.sAtts = { nt: {} }
  await assert.rejects(
    missingProxy.transportConnect({ protocol: 'tcp' }),
    /TCP requires a caller-supplied proxy host and port/
  )

  const invalidProxyPort = new NetworkSession()
  invalidProxyPort.sAtts = { nt: { httpsProxy: '127.0.0.1', httpsProxyPort: 65536 } }
  await assert.rejects(
    invalidProxyPort.transportConnect({ protocol: 'tcp' }),
    /TCP requires a caller-supplied proxy host and port/
  )

  const protocolSwitch = new NetworkSession()
  protocolSwitch.sAtts = { nt: { httpsProxy: '127.0.0.1', httpsProxyPort: 1 } }
  protocolSwitch.transportProtocol = 'TCPS'
  await assert.rejects(
    protocolSwitch.transportConnect({ protocol: 'tcp' }),
    /redirect cannot change protocol from TCPS to TCP/
  )

  const reverseProtocolSwitch = new NetworkSession()
  reverseProtocolSwitch.sAtts = { nt: {} }
  reverseProtocolSwitch.transportProtocol = 'TCP'
  await assert.rejects(
    reverseProtocolSwitch.transportConnect({ protocol: 'tcps' }),
    /redirect cannot change protocol from TCP to TCPS/
  )
}

function testRedirectSecurityFields(packageRoot) {
  const { __getRedirectParamsForTest: getRedirectParams } = loadNetworkSessionTestHooks(packageRoot)
  assert.equal(typeof getRedirectParams, 'function')
  const filtered = getRedirectParams({
    connectTimeout: 1000,
    httpsProxy: 'attacker.invalid',
    httpsProxyPort: 8080,
    walletContent: 'attacker-controlled-wallet',
  })
  assert.deepEqual(filtered, { connectTimeout: 1000 })
}

function testWorker(workerArgument) {
  if (!workerArgument) {
    return
  }
  const workerPath = resolve(process.cwd(), workerArgument)
  assert.equal(statSync(workerPath).isFile(), true)
  assert.match(readFileSync(workerPath, 'utf8'), /verifyOracleDbPatch/)
}

async function main() {
  const workerFlagIndex = process.argv.indexOf('--worker')
  if (workerFlagIndex >= 0 && !process.argv[workerFlagIndex + 1]) {
    throw new Error('--worker requires a path')
  }

  const verification = verifyOracleDbPatch()
  testRedirectSecurityFields(verification.packageRoot)
  await testTransportGuards(verification.packageRoot)
  await testProxyPrecedence(verification.packageRoot)
  testWorker(workerFlagIndex >= 0 ? process.argv[workerFlagIndex + 1] : undefined)
  process.stdout.write('Oracle Database driver patch self-test passed\n')
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
