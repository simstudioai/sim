import { existsSync } from 'node:fs'
import { createOpencodeClient } from '@opencode-ai/sdk'

const OPEN_CODE_HOST = 'opencode'
const OPEN_CODE_LOCALHOST = '127.0.0.1'
const OPEN_CODE_DEFAULT_PORT = '4096'

function getOpenCodeBasicAuthHeader(): string {
  const username = process.env.OPENCODE_SERVER_USERNAME
  const password = process.env.OPENCODE_SERVER_PASSWORD

  if (!username || !password) {
    throw new Error('OpenCode server credentials are not configured')
  }

  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

export function getOpenCodeBaseUrl(): string {
  const explicitBaseUrl = process.env.OPENCODE_BASE_URL?.trim()
  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  const port = process.env.OPENCODE_PORT || OPEN_CODE_DEFAULT_PORT
  const host = existsSync('/.dockerenv') ? OPEN_CODE_HOST : OPEN_CODE_LOCALHOST

  return `http://${host}:${port}`
}

export function createOpenCodeClient() {
  return createOpencodeClient({
    baseUrl: getOpenCodeBaseUrl(),
    headers: {
      Authorization: getOpenCodeBasicAuthHeader(),
    },
  })
}
