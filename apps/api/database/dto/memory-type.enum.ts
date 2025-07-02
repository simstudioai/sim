import { MemoryType } from "../generated/prisma";
import { EnumEntry } from "../lib/enum.util";

export const MemoryTypeEnum = MemoryType;

export const getMemoryTypeEnumEntries = (): EnumEntry[] => [
    { key: MemoryTypeEnum.CORE, value: "Memory" },
    { key: MemoryTypeEnum.ARCHIVAL, value: "Memory with Context" },
    { key: MemoryTypeEnum.SHARED, value: "Memory without Context" },
];