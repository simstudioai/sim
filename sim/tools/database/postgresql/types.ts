import { ToolResponse } from '../../types'

export interface PostgreSQLConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl?: boolean
  schema?: string
}

export interface PostgreSQLQueryParams {
  connection: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl?: boolean;
  };
  operation: 'query' | 'execute';
  query: string;
  params?: any[];
  options?: Record<string, any>;
}

export interface PostgreSQLResponse extends ToolResponse {
  output: {
    rows: any[];
    rowCount: number;
    fields?: Array<{
      name: string;
      tableID: number;
      columnID: number;
      dataTypeID: number;
      dataTypeSize: number;
      dataTypeModifier: number;
      format: string;
    }>;
  };
} 