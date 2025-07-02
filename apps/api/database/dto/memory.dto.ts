import { Type, type Static } from "@sinclair/typebox";

export const MemorySchema = Type.Object({
    id: Type.String(),
    organizationId: Type.String()
});

export const MemoryCreateSchema = Type.Object({

});

export const MemoryUpdateSchema = Type.Object({

});

export type Memory = Static<typeof MemorySchema>;
export type MemoryCreateType = Static<typeof MemoryCreateSchema>;
export type MemoryUpdateType = Static<typeof MemoryUpdateSchema>;