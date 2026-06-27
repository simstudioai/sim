
// Auto-generated types for stripe

export interface Customer {
  id: string;
  email?: string;
  name?: string;
  metadata?: Record<string, any>;
}

export interface Charge {
  id: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending';
}

export interface ListResponse<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
}
