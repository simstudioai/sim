const registry = new Map<string, () => number>()

export function registerCache(name: string, getSize: () => number): void {
  registry.set(name, getSize)
}

export function getCacheSizes(): Record<string, number> {
  const sizes: Record<string, number> = {}
  for (const [name, getSize] of registry) {
    sizes[name] = getSize()
  }
  return sizes
}
