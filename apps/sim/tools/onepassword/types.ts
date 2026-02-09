import type { ToolResponse } from '@/tools/types'

/** Base params shared by all 1Password tools (credential fields). */
export interface OnePasswordBaseParams {
  connectionMode?: 'service_account' | 'connect'
  serviceAccountToken?: string
  apiKey?: string
  serverUrl?: string
}

export interface OnePasswordListVaultsParams extends OnePasswordBaseParams {
  filter?: string
}

export interface OnePasswordGetVaultParams extends OnePasswordBaseParams {
  vaultId: string
}

export interface OnePasswordListItemsParams extends OnePasswordBaseParams {
  vaultId: string
  filter?: string
}

export interface OnePasswordGetItemParams extends OnePasswordBaseParams {
  vaultId: string
  itemId: string
}

export interface OnePasswordCreateItemParams extends OnePasswordBaseParams {
  vaultId: string
  category: string
  title?: string
  tags?: string
  fields?: string
}

export interface OnePasswordUpdateItemParams extends OnePasswordBaseParams {
  vaultId: string
  itemId: string
  operations: string
}

export interface OnePasswordReplaceItemParams extends OnePasswordBaseParams {
  vaultId: string
  itemId: string
  item: string
}

export interface OnePasswordDeleteItemParams extends OnePasswordBaseParams {
  vaultId: string
  itemId: string
}

export interface OnePasswordResolveSecretParams extends OnePasswordBaseParams {
  secretReference: string
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

export interface OnePasswordResolveSecretResponse extends ToolResponse {
  output: {
    secret: string
    reference: string
  }
}
