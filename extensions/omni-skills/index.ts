export const omniSkillsExtension = {
  name: "omni-skills",
  description: "Tracks skill discovery, installation policy, and per-task skill routing.",
  commands: [
    {
      name: "/omni-skills",
      description: "Show installed, recommended, deferred, and rejected skills."
    }
  ]
} as const;
