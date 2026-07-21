import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

type ComposeService = {
  environment?: string[]
}

type ComposeFile = {
  services?: Record<string, ComposeService>
}

function loadCompose(fileName: string): ComposeFile {
  const composePath = new URL(`../../../../../${fileName}`, import.meta.url)
  return load(readFileSync(composePath, 'utf8')) as ComposeFile
}

function environmentValue(
  compose: ComposeFile,
  serviceName: string,
  variableName: string
): string | undefined {
  const prefix = `${variableName}=`
  return compose.services?.[serviceName]?.environment
    ?.find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length)
}

const requiredSecrets: Array<[string, string, string]> = [
  ['docker-compose.prod.yml', 'simstudio', 'BETTER_AUTH_SECRET'],
  ['docker-compose.prod.yml', 'simstudio', 'ENCRYPTION_KEY'],
  ['docker-compose.prod.yml', 'simstudio', 'INTERNAL_API_SECRET'],
  ['docker-compose.prod.yml', 'realtime', 'BETTER_AUTH_SECRET'],
  ['docker-compose.prod.yml', 'realtime', 'INTERNAL_API_SECRET'],
  ['docker-compose.ollama.yml', 'simstudio', 'BETTER_AUTH_SECRET'],
  ['docker-compose.ollama.yml', 'simstudio', 'ENCRYPTION_KEY'],
  ['docker-compose.ollama.yml', 'simstudio', 'INTERNAL_API_SECRET'],
  ['docker-compose.ollama.yml', 'realtime', 'BETTER_AUTH_SECRET'],
  ['docker-compose.ollama.yml', 'realtime', 'INTERNAL_API_SECRET'],
]

describe('Docker Compose secrets', () => {
  it.each(requiredSecrets)(
    '%s requires %s to receive %s via mandatory interpolation',
    (fileName, serviceName, variableName) => {
      const compose = loadCompose(fileName)
      expect(environmentValue(compose, serviceName, variableName)).toMatch(
        new RegExp(`^\\$\\{${variableName}:\\?.+\\}$`)
      )
    }
  )
})
