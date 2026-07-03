import type { ToolResponse } from '@/tools/types'

interface GoogleAppsheetBaseParams {
  apiKey: string
  appId: string
  tableName: string
  region?: string
}

export type GoogleAppsheetRow = Record<string, unknown>

// Find Rows Types
export interface GoogleAppsheetFindParams extends GoogleAppsheetBaseParams {
  selector?: string
}

export interface GoogleAppsheetFindResponse extends ToolResponse {
  output: {
    rows: GoogleAppsheetRow[]
    metadata: {
      rowCount: number
    }
  }
}

// Add Rows Types
export interface GoogleAppsheetAddParams extends GoogleAppsheetBaseParams {
  rows: GoogleAppsheetRow[]
}

export interface GoogleAppsheetAddResponse extends ToolResponse {
  output: {
    rows: GoogleAppsheetRow[]
    metadata: {
      rowCount: number
    }
  }
}

// Edit Rows Types
export interface GoogleAppsheetEditParams extends GoogleAppsheetBaseParams {
  rows: GoogleAppsheetRow[]
}

export interface GoogleAppsheetEditResponse extends ToolResponse {
  output: {
    rows: GoogleAppsheetRow[]
    metadata: {
      rowCount: number
    }
  }
}

// Delete Rows Types
export interface GoogleAppsheetDeleteParams extends GoogleAppsheetBaseParams {
  rows: GoogleAppsheetRow[]
}

export interface GoogleAppsheetDeleteResponse extends ToolResponse {
  output: {
    rows: GoogleAppsheetRow[]
    metadata: {
      rowCount: number
    }
  }
}

export type GoogleAppsheetResponse =
  | GoogleAppsheetFindResponse
  | GoogleAppsheetAddResponse
  | GoogleAppsheetEditResponse
  | GoogleAppsheetDeleteResponse
