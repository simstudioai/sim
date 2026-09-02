'use strict'

const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const RESPONSE_RESERVE_BYTES = 64 * 1024
const MAX_STATEMENTS = 8
// Fetch one row at a time so application byte accounting runs before another
// row is materialized. LOB payloads remain streamed from their locators.
const FETCH_ROWS_PER_CALL = 1
const MAX_NORMALIZED_ITEMS = 100_000
const PROTOCOL_VERSION = 1

let currentConnection
let currentResultSet
let cancelled = false
let responseWritten = false
let requestConnection

class RowLimitError extends Error {}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertDescriptorHost(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 1024 ||
    !/^[A-Za-z0-9._:[\]-]+$/.test(value)
  ) {
    throw new Error('Invalid Oracle Database host')
  }
}

function assertDescriptorValue(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 512 ||
    /[()=\u0000-\u001f\u007f\s]/.test(value)
  ) {
    throw new Error(`Invalid Oracle ${label}`)
  }
}

function validateConnection(connection) {
  if (!isRecord(connection)) throw new Error('Invalid Oracle connection configuration')
  assertDescriptorHost(connection.host)
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
    throw new Error('Invalid Oracle Database port')
  }
  if (connection.protocol !== 'tcp' && connection.protocol !== 'tcps') {
    throw new Error('Invalid Oracle Database protocol')
  }
  if (connection.connectionType !== 'serviceName' && connection.connectionType !== 'sid') {
    throw new Error('Invalid Oracle connection identifier type')
  }
  if (connection.connectionType === 'serviceName') {
    assertDescriptorValue(connection.serviceName, 'service name')
    if (connection.sid !== undefined) throw new Error('Oracle SID must be omitted')
  } else {
    assertDescriptorValue(connection.sid, 'SID')
    if (connection.serviceName !== undefined) throw new Error('Oracle service name must be omitted')
  }
  if (typeof connection.username !== 'string' || typeof connection.password !== 'string') {
    throw new Error('Invalid Oracle Database credentials')
  }
  if (
    !Number.isInteger(connection.connectionTimeout) ||
    connection.connectionTimeout < 1000 ||
    connection.connectionTimeout > 120000
  ) {
    throw new Error('Invalid Oracle Database connection timeout')
  }
  if (connection.proxyHost !== '127.0.0.1') throw new Error('Oracle proxy must use loopback')
  if (
    !Number.isInteger(connection.proxyPort) ||
    connection.proxyPort < 1 ||
    connection.proxyPort > 65535
  ) {
    throw new Error('Invalid Oracle proxy port')
  }
  if (connection.walletContent !== undefined) {
    if (connection.protocol !== 'tcps') throw new Error('Oracle wallet requires TCPS')
    if (
      typeof connection.walletContent !== 'string' ||
      Buffer.byteLength(connection.walletContent, 'utf8') > 1024 * 1024
    ) {
      throw new Error('Invalid Oracle wallet content')
    }
  }
  if (
    connection.walletPassword !== undefined &&
    (typeof connection.walletPassword !== 'string' || connection.walletContent === undefined)
  ) {
    throw new Error('Invalid Oracle wallet password')
  }
}

function validateBinds(binds) {
  if (binds === undefined) return
  if (!isRecord(binds) || Object.keys(binds).length > 100) {
    throw new Error('Invalid Oracle named binds')
  }
  for (const [name, value] of Object.entries(binds)) {
    if (!/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(name)) {
      throw new Error('Invalid Oracle bind name')
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error('Oracle binds must be strings, finite numbers, or null')
    }
  }
}

function validateRequest(request) {
  if (
    !isRecord(request) ||
    request.protocolVersion !== PROTOCOL_VERSION ||
    request.type !== 'execute'
  ) {
    throw new Error('Unsupported Oracle worker request')
  }
  validateConnection(request.connection)
  if (
    !Array.isArray(request.statements) ||
    request.statements.length === 0 ||
    request.statements.length > MAX_STATEMENTS
  ) {
    throw new Error('Invalid Oracle statement batch')
  }
  if (typeof request.readOnlyTransaction !== 'boolean') {
    throw new Error('Invalid Oracle transaction mode')
  }
  for (const statement of request.statements) {
    if (
      !isRecord(statement) ||
      typeof statement.sql !== 'string' ||
      statement.sql.length === 0 ||
      Buffer.byteLength(statement.sql, 'utf8') > 256 * 1024 ||
      !Number.isInteger(statement.maxRows) ||
      statement.maxRows < 1 ||
      statement.maxRows > 10001 ||
      (statement.autoCommit !== undefined && typeof statement.autoCommit !== 'boolean')
    ) {
      throw new Error('Invalid Oracle statement')
    }
    validateBinds(statement.binds)
  }
  return request
}

function buildConnectString(connection) {
  const protocol = connection.protocol.toUpperCase()
  const host =
    connection.host.startsWith('[') && connection.host.endsWith(']')
      ? connection.host.slice(1, -1)
      : connection.host
  const target =
    connection.connectionType === 'serviceName'
      ? `(SERVICE_NAME=${connection.serviceName})`
      : `(SID=${connection.sid})`
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=${protocol})(HOST=${host})(PORT=${connection.port}))(CONNECT_DATA=${target}))`
}

function buildConnectionOptions(connection) {
  const timeoutSeconds = Math.max(1, Math.ceil(connection.connectionTimeout / 1000))
  return {
    user: connection.username,
    password: connection.password,
    connectString: buildConnectString(connection),
    httpsProxy: connection.proxyHost,
    httpsProxyPort: connection.proxyPort,
    connectTimeout: timeoutSeconds,
    transportConnectTimeout: timeoutSeconds,
    retryCount: 0,
    sslServerDNMatch: true,
    ...(connection.walletContent !== undefined && {
      walletContent: connection.walletContent,
    }),
    ...(connection.walletPassword !== undefined && {
      walletPassword: connection.walletPassword,
    }),
  }
}

function safeMessage(error, connection) {
  // utils-lint-allow: this dependency-free CJS worker is copied without workspace packages
  let message = error instanceof Error ? error.message : 'Unknown Oracle Database error'
  const secrets = [connection?.password, connection?.walletContent, connection?.walletPassword]
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0)
      message = message.split(secret).join('[REDACTED]')
  }
  message = message.replace(
    /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
    '[REDACTED PEM]'
  )
  return message.slice(0, 2000)
}

function writeResponse(value) {
  if (responseWritten) return
  responseWritten = true
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) {
    process.stdout.write(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: { message: 'Oracle result exceeded the 10 MiB response ceiling' },
      })
    )
    return
  }
  process.stdout.write(serialized)
}

function uniqueColumnNames(metadata) {
  const used = new Set()
  const counts = new Map()
  return metadata.map((column, index) => {
    const base =
      typeof column?.name === 'string' && column.name.length > 0
        ? column.name
        : `COLUMN_${index + 1}`
    let count = counts.get(base) ?? 0
    let candidate = base
    do {
      count += 1
      candidate = count === 1 ? base : `${base}_${count}`
    } while (used.has(candidate))
    counts.set(base, count)
    used.add(candidate)
    return candidate
  })
}

function normalizeJsonValue(value, state, depth = 0) {
  state.items += 1
  if (state.items > MAX_NORMALIZED_ITEMS || depth > 32) {
    throw new RowLimitError('Oracle value exceeds the normalization complexity limit')
  }
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return { type: 'base64', data: value.toString('base64') }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item, state, depth + 1))
  }
  if (isRecord(value)) {
    if (state.seen.has(value)) throw new RowLimitError('Oracle value contains a cycle')
    state.seen.add(value)
    const normalized = Object.create(null)
    for (const [key, child] of Object.entries(value)) {
      normalized[key] = normalizeJsonValue(child, state, depth + 1)
    }
    state.seen.delete(value)
    return normalized
  }
  return String(value)
}

async function readTextLob(lob, maxEncodedBytes) {
  const chunks = []
  let encodedBytes = 0
  lob.setEncoding('utf8')
  try {
    for await (const chunk of lob) {
      if (cancelled) throw new Error('Oracle operation was cancelled')
      const text = String(chunk)
      const chunkBytes = Math.max(0, Buffer.byteLength(JSON.stringify(text), 'utf8') - 2)
      if (encodedBytes + chunkBytes + 2 > maxEncodedBytes) {
        throw new RowLimitError('Oracle CLOB exceeds the remaining response budget')
      }
      encodedBytes += chunkBytes
      chunks.push(text)
    }
    return chunks.join('')
  } finally {
    lob.destroy()
  }
}

async function readBinaryLob(lob, maxEncodedBytes) {
  const maxRawBytes = Math.max(0, Math.floor((maxEncodedBytes - 32) * 3) / 4)
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of lob) {
      if (cancelled) throw new Error('Oracle operation was cancelled')
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (bytes + data.length > maxRawBytes) {
        throw new RowLimitError('Oracle BLOB exceeds the remaining response budget')
      }
      bytes += data.length
      chunks.push(data)
    }
    return { type: 'base64', data: Buffer.concat(chunks, bytes).toString('base64') }
  } finally {
    lob.destroy()
  }
}

async function normalizeColumnValue(value, remainingBytes, oracledb) {
  if (value instanceof oracledb.Lob) {
    if (value.type === oracledb.DB_TYPE_BFILE) {
      value.destroy()
      throw new Error('Oracle BFILE columns are not supported in v1')
    }
    return value.type === oracledb.DB_TYPE_BLOB
      ? readBinaryLob(value, remainingBytes)
      : readTextLob(value, remainingBytes)
  }
  return normalizeJsonValue(value, { items: 0, seen: new WeakSet() })
}

async function normalizeRow(values, columnNames, remainingBytes, oracledb) {
  const row = Object.create(null)
  let rowBytes = 2
  for (let index = 0; index < values.length; index += 1) {
    const key = columnNames[index]
    const keyBytes = Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + (index === 0 ? 0 : 1)
    const remaining = remainingBytes - rowBytes - keyBytes
    if (remaining <= 0) throw new RowLimitError('Oracle row exceeds the response budget')
    const normalized = await normalizeColumnValue(values[index], remaining, oracledb)
    const valueBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8')
    if (valueBytes > remaining) throw new RowLimitError('Oracle row exceeds the response budget')
    rowBytes += keyBytes + valueBytes
    row[key] = normalized
  }
  return { row, rowBytes }
}

function cleanupRowLobs(values, oracledb) {
  for (const value of values) {
    if (value instanceof oracledb.Lob) value.destroy()
  }
}

function cleanupBatchLobs(batch, startIndex, oracledb) {
  for (let index = startIndex; index < batch.length; index += 1) {
    cleanupRowLobs(batch[index], oracledb)
  }
}

function truncationReason(rowCount, maxRows) {
  return rowCount === 0
    ? 'No rows returned: the first row alone exceeds the 10 MiB response ceiling. Select fewer columns or slice large values in SQL.'
    : `Result truncated to ${rowCount} row(s): one statement returns at most ${maxRows.toLocaleString('en-US')} rows or 10 MiB. Add Oracle OFFSET/FETCH pagination to read the rest.`
}

function assertSupportedColumns(metadata, oracledb) {
  if (
    oracledb.DB_TYPE_CURSOR !== undefined &&
    metadata.some((column) => column.dbType === oracledb.DB_TYPE_CURSOR)
  ) {
    throw new Error('Oracle cursor-expression columns are not supported in v1')
  }
  if (
    oracledb.DB_TYPE_OBJECT !== undefined &&
    metadata.some((column) => column.dbType === oracledb.DB_TYPE_OBJECT)
  ) {
    throw new Error('Oracle object and collection columns are not supported in v1')
  }
  if (
    oracledb.DB_TYPE_BFILE !== undefined &&
    metadata.some((column) => column.dbType === oracledb.DB_TYPE_BFILE)
  ) {
    throw new Error('Oracle BFILE columns are not supported in v1')
  }
  if (
    oracledb.DB_TYPE_XMLTYPE !== undefined &&
    metadata.some((column) => column.dbType === oracledb.DB_TYPE_XMLTYPE)
  ) {
    throw new Error('Oracle XMLTYPE columns are not supported in v1')
  }
  const longTypes = [
    oracledb.DB_TYPE_LONG,
    oracledb.DB_TYPE_LONG_NVARCHAR,
    oracledb.DB_TYPE_LONG_RAW,
  ].filter((type) => type !== undefined)
  if (metadata.some((column) => longTypes.includes(column.dbType))) {
    throw new Error('Oracle LONG, LONG NVARCHAR, and LONG RAW columns are not supported in v1')
  }
  if (
    oracledb.DB_TYPE_JSON !== undefined &&
    metadata.some((column) => column.dbType === oracledb.DB_TYPE_JSON)
  ) {
    throw new Error(
      'Oracle native JSON columns must be serialized with JSON_SERIALIZE(... RETURNING CLOB)'
    )
  }
  if (
    oracledb.DB_TYPE_VECTOR !== undefined &&
    metadata.some((column) => column.dbType === oracledb.DB_TYPE_VECTOR)
  ) {
    throw new Error('Oracle VECTOR columns are not supported in v1')
  }
}

async function consumeResultSet(result, statement, budget, oracledb) {
  const resultSet = result.resultSet
  currentResultSet = resultSet
  const rows = []
  const columnNames = uniqueColumnNames(result.metaData ?? [])
  let truncated = false

  try {
    assertSupportedColumns(result.metaData ?? [], oracledb)
    while (!cancelled) {
      const fetchCount = Math.min(FETCH_ROWS_PER_CALL, statement.maxRows - rows.length + 1)
      const batch = await resultSet.getRows(Math.max(1, fetchCount))
      if (batch.length === 0) break

      for (let index = 0; index < batch.length; index += 1) {
        const values = batch[index]
        if (rows.length >= statement.maxRows) {
          cleanupBatchLobs(batch, index, oracledb)
          truncated = true
          break
        }
        try {
          const normalized = await normalizeRow(values, columnNames, budget.remaining(), oracledb)
          if (!budget.admit(normalized.rowBytes)) {
            cleanupBatchLobs(batch, index, oracledb)
            truncated = true
            break
          }
          rows.push(normalized.row)
        } catch (error) {
          cleanupBatchLobs(batch, index, oracledb)
          if (!(error instanceof RowLimitError)) throw error
          truncated = true
          break
        }
      }
      if (truncated || batch.length < fetchCount) break
    }
  } finally {
    currentResultSet = undefined
    await resultSet.close().catch(() => {})
  }

  if (cancelled) throw new Error('Oracle operation was cancelled')
  return {
    rows,
    rowCount: rows.length,
    ...(truncated && {
      truncated: true,
      truncationReason: truncationReason(rows.length, statement.maxRows),
    }),
  }
}

function createFetchTypeHandler(oracledb) {
  const losslessStringTypes = new Set(
    [
      oracledb.DB_TYPE_NUMBER,
      oracledb.DB_TYPE_BINARY_FLOAT,
      oracledb.DB_TYPE_BINARY_DOUBLE,
      oracledb.DB_TYPE_BINARY_INTEGER,
    ].filter(Boolean)
  )
  return (metadata) =>
    losslessStringTypes.has(metadata.dbType) ? { type: oracledb.DB_TYPE_VARCHAR } : undefined
}

async function executeStatement(connection, statement, budget, oracledb) {
  const result = await connection.execute(statement.sql, statement.binds ?? {}, {
    autoCommit: statement.autoCommit === true,
    outFormat: oracledb.OUT_FORMAT_ARRAY,
    resultSet: true,
    fetchArraySize: FETCH_ROWS_PER_CALL,
    prefetchRows: 0,
    dbObjectAsPojo: true,
    fetchTypeHandler: createFetchTypeHandler(oracledb),
  })

  if (result.resultSet) return consumeResultSet(result, statement, budget, oracledb)
  return {
    rows: [],
    rowCount: Number.isSafeInteger(result.rowsAffected) ? result.rowsAffected : 0,
  }
}

function createBudget() {
  let used = 0
  const limit = MAX_RESPONSE_BYTES - RESPONSE_RESERVE_BYTES
  return {
    remaining: () => Math.max(0, limit - used),
    admit: (rowBytes) => {
      const punctuation = 1
      if (used + rowBytes + punctuation > limit) return false
      used += rowBytes + punctuation
      return true
    },
  }
}

async function cancelCurrentOperation() {
  cancelled = true
  if (currentConnection) await currentConnection.break().catch(() => {})
  if (currentResultSet) await currentResultSet.close().catch(() => {})
  if (currentConnection) await currentConnection.close().catch(() => {})
}

async function run(request) {
  const { verifyOracleDbPatch } = require('../../../scripts/verify-oracledb-patch.cjs')
  verifyOracleDbPatch()
  const oracledb = require('oracledb')
  const connectionConfig = request.connection
  const options = buildConnectionOptions(connectionConfig)

  currentConnection = await oracledb.getConnection(options)
  const budget = createBudget()
  const results = []
  try {
    if (request.readOnlyTransaction) {
      await currentConnection.execute('SET TRANSACTION READ ONLY')
    }
    for (const statement of request.statements) {
      if (cancelled) throw new Error('Oracle operation was cancelled')
      results.push(await executeStatement(currentConnection, statement, budget, oracledb))
    }
    return results
  } finally {
    if (request.readOnlyTransaction) await currentConnection.rollback().catch(() => {})
    await currentConnection.close().catch(() => {})
    currentConnection = undefined
  }
}

async function main() {
  const requestChunks = []
  let requestBytes = 0
  for await (const chunk of process.stdin) {
    requestBytes += chunk.length
    if (requestBytes > MAX_REQUEST_BYTES) throw new Error('Oracle worker request exceeds 8 MiB')
    requestChunks.push(chunk)
  }
  const requestText = Buffer.concat(requestChunks, requestBytes).toString('utf8')
  const parsed = validateRequest(JSON.parse(requestText.trim()))
  requestConnection = parsed.connection
  const results = await run(parsed)
  writeResponse({ protocolVersion: PROTOCOL_VERSION, ok: true, results })
}

process.once('SIGTERM', () => {
  void cancelCurrentOperation().finally(() => process.exit(143))
})

if (require.main === module) {
  void main().catch((error) => {
    if (!cancelled) {
      writeResponse({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: { message: safeMessage(error, requestConnection) },
      })
      process.exitCode = 1
    }
  })
}

module.exports = {
  _test: {
    buildConnectionOptions,
    buildConnectString,
    assertSupportedColumns,
    consumeResultSet,
    createFetchTypeHandler,
    createBudget,
    executeStatement,
    normalizeColumnValue,
    normalizeJsonValue,
    setCancelled: (value) => {
      cancelled = value
    },
    uniqueColumnNames,
    validateRequest,
  },
}
