export const omniMemoryExtension = {
  name: "omni-memory",
  description: "Provides durable `.omni/` file templates and memory update helpers.",
  responsibilities: [
    "create starter files",
    "read current memory state",
    "write focused updates",
    "keep file structure predictable"
  ]
} as const;
