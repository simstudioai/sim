import { ToolResponse } from "../types"

// Types for Create Collection functionality
export interface CreateCollectionParams {
  apiKey: string;
  collectionName: string;
  indexHost: string;
  dimension: number; 
  distance: "Cosine" | "Euclid" | "Dot" | "Manhattan";
}

export interface CreateCollectionResponse {
    result: string;
}

// Types for Upsert Vectors functionality
export interface UpsertVectorsParams {
  apiKey: string;
  collectionName: string;
  indexHost: string;
  vectors: Array<{ 
    id: string | number; 
    vector: number[]; 
    payload?: Record<string, any> 
  }>;
}

export interface UpsertVectorsResponse {
    inserted: number;
}

// Types for Search Vectors functionality
export interface SearchVectorsParams {
  apiKey: string;
  collectionName: string;
  indexHost: string;
  searchVector: string;
  topK?: number;
  filter?: any; 
}

export interface SearchVectorsResponse {
    results: Array<{ id: string; score: number }>;
}

// Types for Retrieve Vectors functionality
export interface RetrieveVectorsParams {
  apiKey: string;
  collectionName: string;
  indexHost: string;
  ids: string[];
}

export interface RetrieveVectorsResponse {
    vectors: Array<{ id: string; vector: number[] }>;
}

export interface QdrantResponse extends ToolResponse {
  output: {
    result?: string; 
    inserted?: number;
    results?: Array<{ id: string; score: number }>;
    vectors?: Array<{ id: string; vector: number[] }>;
  }
}