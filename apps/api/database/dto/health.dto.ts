import { Type, type Static } from "@sinclair/typebox";


export const HealthCheckSchema = Type.Object({
    status: Type.String(),
    version: Type.String()
});


export type HealthCheck = Static<typeof HealthCheckSchema>;