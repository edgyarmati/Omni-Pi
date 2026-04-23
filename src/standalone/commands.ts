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
  { name: "model", args: "<provider>/<id>", description: "switch the active model or open the picker", kind: "standalone", supported: true },
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
  { name: "providers", description: "connect providers and manage model availability", kind: "standalone", supported: true },
  { name: "omni-mode", description: "toggle Omni mode for this project", kind: "omni-extension", supported: true },
  { name: "omni-rtk", args: "<status|install|on|off>", description: "control global RTK bash routing", kind: "omni-extension", supported: true },
  { name: "theme", description: "pick an Omni theme", kind: "omni-extension", supported: true },
  { name: "model-setup", description: "add, refresh, or remove custom model entries", kind: "omni-extension", supported: true },
  { name: "manage-providers", description: "remove stored bundled-provider auth", kind: "omni-extension", supported: true },
  { name: "update", description: "check for Omni-Pi updates", kind: "omni-extension", supported: true },
  { name: "settings", description: "open Pi settings menu", kind: "pi-builtin", supported: true },
  { name: "scoped-models", description: "enable/disable models for Ctrl+P cycling", kind: "pi-builtin", supported: true },
  { name: "tree", description: "navigate the session tree", kind: "pi-builtin", supported: false },
  { name: "reload", description: "reload keybindings, extensions, skills, prompts, and themes", kind: "pi-builtin", supported: true },
  { name: "copy", description: "copy the last assistant message", kind: "pi-builtin", supported: true },
  { name: "share", description: "share session as a secret GitHub gist", kind: "pi-builtin", supported: true },
  { name: "export", args: "[file]", description: "export session (HTML default, .jsonl for raw)", kind: "pi-builtin", supported: true },
  { name: "import", args: "<file>", description: "import and resume a session from a JSONL file", kind: "pi-builtin", supported: true },
  { name: "login", description: "login with OAuth provider", kind: "pi-builtin", supported: true },
  { name: "logout", description: "logout from OAuth provider", kind: "pi-builtin", supported: true },
  { name: "hotkeys", description: "show keyboard shortcuts", kind: "pi-builtin", supported: true },
  { name: "changelog", description: "show version history", kind: "pi-builtin", supported: true },
  { name: "quit", description: "quit Omni", kind: "pi-builtin", supported: true }
];

function isBoundaryChar(char: string | undefined): boolean {
  return !char || char === "-" || char === "_" || char === "/" || char === ".";
}

function scoreSlashCommandMatch(name: string, query: string): number {
  const candidate = name.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return 0;
  if (candidate.startsWith(needle)) return 10_000 - candidate.length;

  let score = 0;
  let searchIndex = 0;
  let consecutive = 0;

  for (const char of needle) {
    const foundIndex = candidate.indexOf(char, searchIndex);
    if (foundIndex === -1) {
      return Number.NEGATIVE_INFINITY;
    }

    score += 10;

    if (foundIndex === searchIndex) {
      consecutive += 1;
      score += 8 + consecutive * 2;
    } else {
      consecutive = 0;
      score -= foundIndex - searchIndex;
    }

    if (isBoundaryChar(candidate[foundIndex - 1])) {
      score += 20;
    }

    searchIndex = foundIndex + 1;
  }

  score -= candidate.length;
  return score;
}

export function filterStandaloneSlashCommands(value: string): StandaloneSlashCommand[] {
  if (!value.startsWith("/")) return [];
  const rest = value.slice(1);
  if (rest.includes(" ")) return [];
  const query = rest.toLowerCase();
  if (!query) return STANDALONE_SLASH_COMMANDS;

  return STANDALONE_SLASH_COMMANDS
    .map((cmd) => ({ cmd, score: scoreSlashCommandMatch(cmd.name, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.cmd.name.localeCompare(right.cmd.name))
    .map((entry) => entry.cmd);
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
