export type AgentContact = { senderId: string; enabled: boolean; note: string; updatedAt?: string };
export type AgentMemory = { id: number; memory: string; category: string; enabled: boolean; createdAt?: string };
export type AgentPreferences = { tone: string; language: string; replyLength: string; memoryEnabled: boolean };
