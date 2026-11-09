'use client'

import { createContext, useContext } from 'react'

const AssetBasePath = createContext('')

/** Reads the asset prefix installed by the host application. */
export function useAssetBasePath() {
  return useContext(AssetBasePath)
}
