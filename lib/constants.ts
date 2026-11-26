export const applicationNamespaces = ["chat", "video", "reader", "social", "task", "marketplace", "restaurant"] as const;

export type GorthApplication = (typeof applicationNamespaces)[number];

export const applicationScopes = {
  chat: { read: "chat:read", write: "chat:write" },
  video: { read: "video:read", write: "video:write" },
  reader: { read: "reader:read", write: "reader:write" },
  social: { read: "social:read", write: "social:write" },
  task: { read: "task:read", write: "task:write" },
  marketplace: { read: "marketplace:read", write: "marketplace:write" },
  restaurant: { read: "restaurant:read", write: "restaurant:write" },
} satisfies Record<GorthApplication, Record<"read" | "write", string>>
