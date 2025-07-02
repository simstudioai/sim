import { Type, type Static } from '@sinclair/typebox';

export const BlockSchema = Type.Object({
    id: Type.String(),
    value: Type.String(),
    limit: Type.Integer(),
    templateName: Type.Optional(Type.String()),
    label: Type.String(),
    metadata: Type.Optional(Type.Any()),
    description: Type.Optional(Type.String()),
    isTemplate: Type.Boolean(),
    organizationId: Type.String(),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
    isDeleted: Type.Boolean(),
    createdById: Type.Optional(Type.String()),
    lastUpdatedById: Type.Optional(Type.String())
});

export const BlockCreateSchema = Type.Object({
    value: Type.String(),
    limit: Type.Integer(),
    templateName: Type.Optional(Type.String()),
    label: Type.String(),
    metadata: Type.Optional(Type.Any()),
    description: Type.Optional(Type.String()),
    isTemplate: Type.Optional(Type.Boolean()),
    organizationId: Type.String()
});

export const BlockUpdateSchema = Type.Object({
    value: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer()),
    templateName: Type.Optional(Type.String()),
    label: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any()),
    description: Type.Optional(Type.String()),
    isTemplate: Type.Optional(Type.Boolean()),
    userId: Type.String()
});

export type BlockType = Static<typeof BlockSchema>;
export type BlockCreateType = Static<typeof BlockCreateSchema>;
export type BlockUpdateType = Static<typeof BlockUpdateSchema>;