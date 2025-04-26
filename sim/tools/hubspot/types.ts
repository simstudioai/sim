// /sim/tools/hubspot/types.ts
import { ToolResponse } from "../types"

//
// CONTACTS
//
export interface ListContactsParams {
  accessToken: string
  limit?: number
}
export interface ListContactsResponse extends ToolResponse {
  output: any  // HubSpot returns a page of contacts
}

export interface CreateContactParams {
  accessToken: string
  properties: Record<string, any>
}
export interface CreateContactResponse extends ToolResponse {
  output: any  // Newly created contact object
}

export interface SearchContactsParams {
  accessToken: string
  filterGroups: any[]
  sorts?: string[]
  limit?: number
}
export interface SearchContactsResponse extends ToolResponse {
  output: any  // Search results page
}

//
// DEALS
//
export interface ListDealsParams {
  accessToken: string
  limit?: number
}
export interface ListDealsResponse extends ToolResponse {
  output: any  // Page of deals
}

export interface CreateDealParams {
  accessToken: string
  properties: Record<string, any>
}
export interface CreateDealResponse extends ToolResponse {
  output: any  // Newly created deal
}

export interface SearchDealsParams {
  accessToken: string
  filterGroups: any[]
  sorts?: string[]
  limit?: number
}
export interface SearchDealsResponse extends ToolResponse {
  output: any  // Search results page
}

//
// MARKETING
//
export interface ListCampaignsParams {
  accessToken: string
  limit?: number
}
export interface ListCampaignsResponse extends ToolResponse {
  output: any  // Page of campaigns
}

export interface ListFormsParams {
  accessToken: string
  limit?: number
}
export interface ListFormsResponse extends ToolResponse {
  output: any  // Page of forms
}
