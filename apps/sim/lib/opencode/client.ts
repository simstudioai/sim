import { existsSync } from 'node:fs'
import { createOpencodeClient } from '@opencode-ai/sdk'

const OPEN_CODE_HOST = 'opencode'
const OPEN_CODE_LOCALHOST = '127.0.0.1'
const OPEN_CODE_DEFAULT_PORT = '4096'
const IS_DOCKER_RUNTIME = existsSync('/.dockerenv')
let cachedOpenCodeClient: ReturnType<typeof createOpencodeClient> | null = null
let cachedOpenCodeClientKey: string | null = null

function getOpenCodeBasicAuthHeader(): string {
  const username = process.env.OPENCODE_SERVER_USERNAME
  const password = process.env.OPENCODE_SERVER_PASSWORD

  if (!username || !password) {
    throw new Error('OpenCode server credentials are not configured')
  }

  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function getOpenCodeBaseUrl(): string {
  const explicitBaseUrl = process.env.OPENCODE_BASE_URL?.trim()
  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  const port = process.env.OPENCODE_PORT || OPEN_CODE_DEFAULT_PORT
  const host = IS_DOCKER_RUNTIME ? OPEN_CODE_HOST : OPEN_CODE_LOCALHOST

  return `http://${host}:${port}`
}

function getOpenCodeClientKey(): string {
  return JSON.stringify({
    baseUrl: getOpenCodeBaseUrl(),
    authorization: getOpenCodeBasicAuthHeader(),
  })
}

export function createOpenCodeClient() {
  const clientKey = getOpenCodeClientKey()

  if (!cachedOpenCodeClient || cachedOpenCodeClientKey !== clientKey) {
    cachedOpenCodeClient = createOpencodeClient({
      baseUrl: JSON.parse(clientKey).baseUrl,
      headers: {
        Authorization: JSON.parse(clientKey).authorization,
      },
    })
    cachedOpenCodeClientKey = clientKey
  }

  return cachedOpenCodeClient
}

export function resetOpenCodeClientForTesting(): void {
  cachedOpenCodeClient = null
  cachedOpenCodeClientKey = null
}
