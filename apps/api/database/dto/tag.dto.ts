import { Type, type Static } from "@sinclair/typebox";

export const ExampleSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    color: Type.Optional(Type.String()),
    createdAt: Type.Optional(Type.String({ format: "date-time" })),
    updatedAt: Type.Optional(Type.String({ format: "date-time" })),
    organizationId: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const ExampleCreateSchema = Type.Object({
    name: Type.String(),
    color: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const ExampleUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    color: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export type ExampleType = Static<typeof ExampleSchema>;
export type ExampleCreateType = Static<typeof ExampleCreateSchema>;
export type ExampleUpdateType = Static<typeof ExampleUpdateSchema>;