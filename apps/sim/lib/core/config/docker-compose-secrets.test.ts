import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

type ComposeService = {
  environment?: string[]
}

type ComposeFile = {
  services?: Record<string, ComposeService>
}

const composePath = new URL('../../../../../docker-compose.prod.yml', import.meta.url)
const compose = load(readFileSync(composePath, 'utf8')) as ComposeFile

function environmentValue(serviceName: string, variableName: string): string | undefined {
  const prefix = `${variableName}=`
  return compose.services?.[serviceName]?.environment
    ?.find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length)
}

describe('production Docker Compose secrets', () => {
  it.each([
    ['simstudio', 'BETTER_AUTH_SECRET'],
    ['simstudio', 'ENCRYPTION_KEY'],
    ['simstudio', 'INTERNAL_API_SECRET'],
    ['realtime', 'BETTER_AUTH_SECRET'],
    ['realtime', 'INTERNAL_API_SECRET'],
  ])('requires %s to receive %s', (serviceName, variableName) => {
    expect(environmentValue(serviceName, variableName)).toMatch(
      new RegExp(`^\\$\\{${variableName}:\\?.+\\}$`)
    )
  })
})
