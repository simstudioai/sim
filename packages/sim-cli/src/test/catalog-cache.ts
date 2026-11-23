import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Caches catalog JSON `text` in config directory `configDir` as the CLI does: the catalog under its
 * hash, and `workspaceId`'s pointer to it unless `workspaceId` is `null`.
 */
export function cacheCatalogText(
  configDir: string,
  workspaceId: string | null,
  text: string
): void {
  const { hash } = JSON.parse(text) as { hash: string }
  const root = join(configDir, 'cache/source-catalog')
  mkdirSync(join(root, 'workspaces'), { recursive: true })
  writeFileSync(join(root, `${hash}.json`), text)
  if (workspaceId !== null) {
    writeFileSync(join(root, 'workspaces', `${workspaceId}.json`), JSON.stringify({ hash }))
  }
}
