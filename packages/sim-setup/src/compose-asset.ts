import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SETUP_CONTEXT, type SetupContext } from './context'

const COMPOSE_FILE = 'docker-compose.prod.yml'
const SIM_COMPOSE_MARKER = 'ghcr.io/simstudioai/simstudio'
const MANAGED_STATE_FILE = '.sim-setup.json'

interface ManagedState {
  schemaVersion: 1
  composeSha256: string
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

function readManagedState(root: string): ManagedState | null {
  const file = path.join(root, MANAGED_STATE_FILE)
  if (!existsSync(file)) return null
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('schemaVersion' in parsed) ||
    parsed.schemaVersion !== 1 ||
    !('composeSha256' in parsed) ||
    typeof parsed.composeSha256 !== 'string'
  ) {
    throw new Error(`${file} is not a valid sim-setup managed-state file`)
  }
  return { schemaVersion: 1, composeSha256: parsed.composeSha256 }
}

function writeManagedState(root: string, contents: string): void {
  const state: ManagedState = { schemaVersion: 1, composeSha256: sha256(contents) }
  writeFileSync(path.join(root, MANAGED_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`)
}

function packagedComposeFile(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  return path.basename(moduleDirectory) === 'src'
    ? path.resolve(moduleDirectory, '../../..', COMPOSE_FILE)
    : path.join(moduleDirectory, COMPOSE_FILE)
}

/** Materializes the published Compose asset without overwriting user-customized files. */
export function ensureProductionComposeFile(context: SetupContext = SETUP_CONTEXT): string {
  const destination = path.join(context.root, COMPOSE_FILE)
  if (context.kind === 'source') {
    if (!existsSync(destination)) {
      throw new Error(`Sim source checkout is missing ${COMPOSE_FILE}`)
    }
    return destination
  }

  const bundled = packagedComposeFile()
  if (!existsSync(bundled)) {
    throw new Error(`The sim-setup package is missing its bundled ${COMPOSE_FILE}`)
  }
  mkdirSync(context.root, { recursive: true })
  const packaged = readFileSync(bundled, 'utf8')
  if (existsSync(destination)) {
    const current = readFileSync(destination, 'utf8')
    if (current === packaged) {
      writeManagedState(context.root, packaged)
      return destination
    }
    if (!current.includes(SIM_COMPOSE_MARKER)) {
      throw new Error(`${destination} exists but is not a recognized Sim Compose file`)
    }
    const managed = readManagedState(context.root)
    if (!managed || managed.composeSha256 !== sha256(current)) {
      throw new Error(
        `${destination} has local changes; preserve or remove your customizations before updating it.`
      )
    }
  }
  copyFileSync(bundled, destination)
  writeManagedState(context.root, packaged)
  return destination
}
