import { ToolResponse } from "../types"

export interface ClayPopulateParams {
    webhookId: string
    data: JSON
}

export interface ClayPopulateResponse extends ToolResponse {
    output: {
        data: any
    }
}