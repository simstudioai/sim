import { Type, type Static } from "@sinclair/typebox";

export const MemoryBlockSchema = Type.Object({
    id: Type.String(),
    organizationId: Type.String()
});

export const MemoryBlockCreateSchema = Type.Object({

});

export const MemoryBlockUpdateSchema = Type.Object({

});

export type MemoryBlock = Static<typeof MemoryBlockSchema>;
export type MemoryBlockCreateType = Static<typeof MemoryBlockCreateSchema>;
export type MemoryBlockUpdateType = Static<typeof MemoryBlockUpdateSchema>;