import { ToolResponse } from "../types"

// Domain Overview
export interface SemrushDomainOverviewParams {
  apiKey: string;
  domain: string;
  database?: string;
}

export interface SemrushDomainOverviewResponse extends ToolResponse {
  output: {
    Db?: string;
    Dn?: string;
    OrganicKeywords?: number;
    OrganicTraffic?: number;
    OrganicCost?: number;
    [key: string]: any;
  }
}

// Domain Keywords
export interface SemrushDomainKeywordsParams {
  apiKey: string;
  domain: string;
  database?: string;
}

export interface SemrushDomainKeywordsResponse extends ToolResponse {
  output: {
    // Define based on Semrush API return structure:
    keywords?: Array<Record<string, any>>;
    [key: string]: any;
  }
}

// Keyword Overview
export interface SemrushKeywordOverviewParams {
  apiKey: string;
  keyword: string;
  database?: string;
}

export interface SemrushKeywordOverviewResponse extends ToolResponse {
  output: {
    Ph?: string;
    Po?: string;
    Nq?: number;
    Cp?: number;
    Co?: number;
    Nr?: number;
    [key: string]: any;
  }
}

// URL Keywords
export interface SemrushUrlKeywordsParams {
  apiKey: string;
  url: string;
  database?: string;
}

export interface SemrushUrlKeywordsResponse extends ToolResponse {
  output: {
    keywords?: Array<Record<string, any>>;
    [key: string]: any;
  }
}