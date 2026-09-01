import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageRoot, '../..')
const dist = path.join(packageRoot, 'dist')

mkdirSync(dist, { recursive: true })
const compose = readFileSync(path.join(repositoryRoot, 'docker-compose.prod.yml'), 'utf8')
if (/^\s+(?:build|context):/m.test(compose)) {
  throw new Error('docker-compose.prod.yml must not contain local build dependencies')
}
if (!compose.includes('ghcr.io/simstudioai/simstudio')) {
  throw new Error('docker-compose.prod.yml is missing the published Sim image')
}
writeFileSync(path.join(dist, 'docker-compose.prod.yml'), compose)
chmodSync(path.join(dist, 'index.js'), 0o755)
