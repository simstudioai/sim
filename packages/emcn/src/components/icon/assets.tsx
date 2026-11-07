'use client'

import { createContext, type ReactNode, useContext } from 'react'

const AssetBasePath = createContext('')

interface AssetsProviderProps {
  basePath: string
  children: ReactNode
}

/** Supplies the host's public asset prefix without coupling shared controls to its router. */
export function AssetsProvider({ basePath, children }: AssetsProviderProps) {
  return <AssetBasePath.Provider value={basePath}>{children}</AssetBasePath.Provider>
}

/** Reads the asset prefix installed by the host application. */
export function useAssetBasePath() {
  return useContext(AssetBasePath)
}
