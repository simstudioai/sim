import type { ToolResponse } from '@/tools/types'

export interface OnePasswordListVaultsParams {
  apiKey: string
  serverUrl: string
  filter?: string
}

export interface OnePasswordGetVaultParams {
  apiKey: string
  serverUrl: string
  vaultId: string
}

export interface OnePasswordListItemsParams {
  apiKey: string
  serverUrl: string
  vaultId: string
  filter?: string
}

export interface OnePasswordGetItemParams {
  apiKey: string
  serverUrl: string
  vaultId: string
  itemId: string
}

export interface OnePasswordCreateItemParams {
  apiKey: string
  serverUrl: string
  vaultId: string
  category: string
  title?: string
  tags?: string
  fields?: string
}

export interface OnePasswordUpdateItemParams {
  apiKey: string
  serverUrl: string
  vaultId: string
  itemId: string
  operations: string
}

export interface OnePasswordReplaceItemParams {
  apiKey: string
  serverUrl: string
  vaultId: string
  itemId: string
  item: string
}

export interface OnePasswordDeleteItemParams {
  apiKey: string
  serverUrl: string
  vaultId: string
  itemId: string
}

export interface OnePasswordListVaultsResponse extends ToolResponse {
  output: {
    vaults: Array<{
      id: string
      name: string
      description: string | null
      attributeVersion: number
      contentVersion: number
      items: number
      type: string
      createdAt: string | null
      updatedAt: string | null
    }>
  }
}

export interface OnePasswordGetVaultResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    attributeVersion: number
    contentVersion: number
    items: number
    type: string
    createdAt: string | null
    updatedAt: string | null
  }
}

export interface OnePasswordListItemsResponse extends ToolResponse {
  output: {
    items: Array<{
      id: string
      title: string
      vault: { id: string }
      category: string
      urls: Array<{ href: string; label: string | null; primary: boolean }>
      favorite: boolean
      tags: string[]
      version: number
      state: string | null
      createdAt: string | null
      updatedAt: string | null
      lastEditedBy: string | null
    }>
  }
}

export interface OnePasswordFullItemResponse extends ToolResponse {
  output: {
    id: string
    title: string
    vault: { id: string }
    category: string
    urls: Array<{ href: string; label: string | null; primary: boolean }>
    favorite: boolean
    tags: string[]
    version: number
    state: string | null
    fields: Array<{
      id: string
      label: string | null
      type: string
      purpose: string
      value: string | null
      section: { id: string } | null
      generate: boolean
      recipe: {
        length: number | null
        characterSets: string[]
        excludeCharacters: string | null
      } | null
      entropy: number | null
    }>
    sections: Array<{
      id: string
      label: string | null
    }>
    createdAt: string | null
    updatedAt: string | null
    lastEditedBy: string | null
  }
}

export type OnePasswordGetItemResponse = OnePasswordFullItemResponse
export type OnePasswordCreateItemResponse = OnePasswordFullItemResponse
export type OnePasswordUpdateItemResponse = OnePasswordFullItemResponse
export type OnePasswordReplaceItemResponse = OnePasswordFullItemResponse

export interface OnePasswordDeleteItemResponse extends ToolResponse {
  output: {
    success: boolean
  }
}
