interface Model {
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details: object;
  }
  
export interface ModelsObject {
    models: Model[];
  }