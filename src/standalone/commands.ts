export interface StandaloneSlashCommand {
  name: string;
  args?: string;
  description: string;
  kind: "standalone" | "omni-extension" | "pi-builtin";
  supported: boolean;
}

export const STANDALONE_SLASH_COMMANDS: StandaloneSlashCommand[] = [
  { name: "help", description: "show available commands", kind: "standalone", supported: true },
  { name: "new", description: "start a fresh session", kind: "standalone", supported: true },
  { name: "model", args: "<provider>/<id>", description: "switch the active model", kind: "standalone", supported: true },
  { name: "thinking", args: "<level>", description: "set thinking budget", kind: "standalone", supported: true },
  { name: "steer", args: "<msg>", description: "queue a steering message", kind: "standalone", supported: true },
  { name: "followup", args: "<msg>", description: "queue a follow-up prompt", kind: "standalone", supported: true },
  { name: "switch", args: "<session>", description: "switch to another session", kind: "standalone", supported: true },
  { name: "fork", args: "<entry-id>", description: "fork from a prior entry", kind: "standalone", supported: true },
  { name: "compact", args: "[instructions]", description: "manually compact the session context", kind: "pi-builtin", supported: true },
  { name: "session", description: "show session info and stats", kind: "pi-builtin", supported: true },
  { name: "name", args: "<name>", description: "set session display name", kind: "pi-builtin", supported: true },
  { name: "resume", args: "<session>", description: "resume a different session by path", kind: "pi-builtin", supported: true },
  { name: "sessions", description: "search and switch to another session", kind: "standalone", supported: true },
  { name: "omni-mode", description: "toggle Omni mode for this project", kind: "omni-extension", supported: true },
  { name: "theme", description: "pick an Omni theme", kind: "omni-extension", supported: true },
  { name: "model-setup", description: "add, refresh, or remove custom model entries", kind: "omni-extension", supported: true },
  { name: "manage-providers", description: "remove stored bundled-provider auth", kind: "omni-extension", supported: true },
  { name: "update", description: "check for Omni-Pi updates", kind: "omni-extension", supported: true },
  { name: "settings", description: "open Pi settings menu", kind: "pi-builtin", supported: true },
  { name: "scoped-models", description: "enable/disable models for Ctrl+P cycling", kind: "pi-builtin", supported: true },
  { name: "tree", description: "navigate the session tree", kind: "pi-builtin", supported: false },
  { name: "reload", description: "reload keybindings, extensions, skills, prompts, and themes", kind: "pi-builtin", supported: true },
  { name: "copy", description: "copy the last assistant message", kind: "pi-builtin", supported: true },
  { name: "share", description: "share the session", kind: "pi-builtin", supported: false },
  { name: "export", args: "[file]", description: "export the session", kind: "pi-builtin", supported: false },
  { name: "import", args: "<file>", description: "import and resume a session", kind: "pi-builtin", supported: false },
  { name: "login", description: "login with OAuth provider", kind: "pi-builtin", supported: true },
  { name: "logout", description: "logout from OAuth provider", kind: "pi-builtin", supported: true },
  { name: "hotkeys", description: "show keyboard shortcuts", kind: "pi-builtin", supported: true },
  { name: "changelog", description: "show version history", kind: "pi-builtin", supported: true },
  { name: "quit", description: "quit Omni", kind: "pi-builtin", supported: true }
];

export function filterStandaloneSlashCommands(value: string): StandaloneSlashCommand[] {
  if (!value.startsWith("/")) return [];
  const rest = value.slice(1);
  if (rest.includes(" ")) return [];
  const query = rest.toLowerCase();
  return STANDALONE_SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(query));
}

export function renderStandaloneHelp(): string {
  const supported = STANDALONE_SLASH_COMMANDS.filter((command) => command.supported)
    .map((command) => `/${command.name}${command.args ? ` ${command.args}` : ""} — ${command.description}`);
  const pending = STANDALONE_SLASH_COMMANDS.filter((command) => !command.supported)
    .map((command) => `/${command.name}${command.args ? ` ${command.args}` : ""}`);

  return [
    "Available now:",
    ...supported.map((line) => `- ${line}`),
    "",
    "Known but not bridged in standalone yet:",
    pending.length > 0 ? pending.map((line) => `- ${line}`).join("\n") : "- none",
  ].join("\n");
}

export function findStandaloneSlashCommand(name: string): StandaloneSlashCommand | undefined {
  return STANDALONE_SLASH_COMMANDS.find((command) => command.name === name);
}
