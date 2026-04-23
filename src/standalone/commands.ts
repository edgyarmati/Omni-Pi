/**
 * Adapted from OpenCode's command registration model
 * (vendor/opencode-tui/component/dialog-command.tsx, MIT).
 *
 * This keeps Omni standalone command/slash behavior closer to upstream
 * while still routing execution through Omni Pi-RPC controller logic.
 */

export interface StandaloneSlashCommand {
  name: string;
  args?: string;
  aliases?: string[];
  description: string;
  kind: "standalone" | "omni-extension" | "pi-builtin";
  supported: boolean;
}

export interface StandaloneCommandOption {
  title: string;
  value: string;
  description: string;
  kind: "standalone" | "omni-extension" | "pi-builtin";
  supported: boolean;
  args?: string;
  slash?: {
    name: string;
    aliases?: string[];
  };
  hidden?: boolean;
  enabled?: boolean;
}

export interface StandaloneCommandRegistry {
  register(cb: () => StandaloneCommandOption[]): () => void;
  entries(): StandaloneCommandOption[];
  visibleEntries(): StandaloneCommandOption[];
  slashes(): StandaloneSlashCommand[];
  trigger(name: string): void;
}

function createBaseCommandOptions(): StandaloneCommandOption[] {
  return [
    { title: "help", value: "help", description: "show available commands", kind: "standalone", supported: true, slash: { name: "help" } },
    { title: "new", value: "new", description: "start a fresh session", kind: "standalone", supported: true, slash: { name: "new" } },
    { title: "model", value: "model", args: "<provider>/<id>", description: "switch the active model or open the picker", kind: "standalone", supported: true, slash: { name: "model" } },
    { title: "thinking", value: "thinking", args: "<level>", description: "set thinking budget", kind: "standalone", supported: true, slash: { name: "thinking" } },
    { title: "steer", value: "steer", args: "<msg>", description: "queue a steering message", kind: "standalone", supported: true, slash: { name: "steer" } },
    { title: "followup", value: "followup", args: "<msg>", description: "queue a follow-up prompt", kind: "standalone", supported: true, slash: { name: "followup", aliases: ["follow-up"] } },
    { title: "switch", value: "switch", args: "<session>", description: "switch to another session", kind: "standalone", supported: true, slash: { name: "switch" } },
    { title: "fork", value: "fork", args: "<entry-id>", description: "fork from a prior entry", kind: "standalone", supported: true, slash: { name: "fork" } },
    { title: "compact", value: "compact", args: "[instructions]", description: "manually compact the session context", kind: "pi-builtin", supported: true, slash: { name: "compact" } },
    { title: "session", value: "session", description: "show session info and stats", kind: "pi-builtin", supported: true, slash: { name: "session" } },
    { title: "name", value: "name", args: "<name>", description: "set session display name", kind: "pi-builtin", supported: true, slash: { name: "name" } },
    { title: "resume", value: "resume", args: "<session>", description: "resume a different session by path", kind: "pi-builtin", supported: true, slash: { name: "resume" } },
    { title: "sessions", value: "sessions", description: "search and switch to another session", kind: "standalone", supported: true, slash: { name: "sessions" } },
    { title: "providers", value: "providers", description: "connect providers and manage model availability", kind: "standalone", supported: true, slash: { name: "providers" } },
    { title: "omni-mode", value: "omni-mode", description: "toggle Omni mode for this project", kind: "omni-extension", supported: true, slash: { name: "omni-mode" } },
    { title: "omni-rtk", value: "omni-rtk", args: "<status|install|on|off>", description: "control global RTK bash routing", kind: "omni-extension", supported: true, slash: { name: "omni-rtk", aliases: ["rtk"] } },
    { title: "theme", value: "theme", description: "pick an Omni theme", kind: "omni-extension", supported: true, slash: { name: "theme" } },
    { title: "model-setup", value: "model-setup", description: "add, refresh, or remove custom model entries", kind: "omni-extension", supported: true, slash: { name: "model-setup" } },
    { title: "manage-providers", value: "manage-providers", description: "remove stored bundled-provider auth", kind: "omni-extension", supported: true, slash: { name: "manage-providers" } },
    { title: "update", value: "update", description: "check for Omni-Pi updates", kind: "omni-extension", supported: true, slash: { name: "update" } },
    { title: "settings", value: "settings", description: "open Pi settings menu", kind: "pi-builtin", supported: true, slash: { name: "settings" } },
    { title: "scoped-models", value: "scoped-models", description: "enable/disable models for Ctrl+P cycling", kind: "pi-builtin", supported: true, slash: { name: "scoped-models" } },
    { title: "tree", value: "tree", description: "navigate the session tree", kind: "pi-builtin", supported: false, slash: { name: "tree" } },
    { title: "reload", value: "reload", description: "reload keybindings, extensions, skills, prompts, and themes", kind: "pi-builtin", supported: true, slash: { name: "reload" } },
    { title: "copy", value: "copy", description: "copy the last assistant message", kind: "pi-builtin", supported: true, slash: { name: "copy" } },
    { title: "share", value: "share", description: "share session as a secret GitHub gist", kind: "pi-builtin", supported: true, slash: { name: "share" } },
    { title: "export", value: "export", args: "[file]", description: "export session (HTML default, .jsonl for raw)", kind: "pi-builtin", supported: true, slash: { name: "export" } },
    { title: "import", value: "import", args: "<file>", description: "import and resume a session from a JSONL file", kind: "pi-builtin", supported: true, slash: { name: "import" } },
    { title: "login", value: "login", description: "login with OAuth provider", kind: "pi-builtin", supported: true, slash: { name: "login" } },
    { title: "logout", value: "logout", description: "logout from OAuth provider", kind: "pi-builtin", supported: true, slash: { name: "logout" } },
    { title: "hotkeys", value: "hotkeys", description: "show keyboard shortcuts", kind: "pi-builtin", supported: true, slash: { name: "hotkeys" } },
    { title: "changelog", value: "changelog", description: "show version history", kind: "pi-builtin", supported: true, slash: { name: "changelog" } },
    { title: "quit", value: "quit", description: "quit Omni", kind: "pi-builtin", supported: true, slash: { name: "quit", aliases: ["exit"] } },
  ];
}

export function createStandaloneCommandRegistry(
  initialRegistrations: Array<() => StandaloneCommandOption[]> = [],
): StandaloneCommandRegistry {
  const registrations = [...initialRegistrations];

  const entries = () => registrations.flatMap((cb) => cb());
  const visibleEntries = () =>
    entries().filter((option) => option.enabled !== false && !option.hidden);

  return {
    register(cb) {
      registrations.unshift(cb);
      return () => {
        const index = registrations.indexOf(cb);
        if (index >= 0) {
          registrations.splice(index, 1);
        }
      };
    },
    entries,
    visibleEntries,
    slashes() {
      return visibleEntries().flatMap((option) => {
        const slash = option.slash;
        if (!slash) return [];
        return {
          name: slash.name,
          args: option.args,
          aliases: slash.aliases,
          description: option.description ?? option.title,
          kind: option.kind,
          supported: option.supported,
        } satisfies StandaloneSlashCommand;
      });
    },
    trigger(name) {
      const option = entries().find((entry) => entry.value === name);
      if (!option || option.enabled === false) return;
      // execution is handled in controller via /command text
    },
  };
}

export const DEFAULT_STANDALONE_COMMAND_REGISTRY =
  createStandaloneCommandRegistry([createBaseCommandOptions]);

export const STANDALONE_SLASH_COMMANDS: StandaloneSlashCommand[] =
  DEFAULT_STANDALONE_COMMAND_REGISTRY.slashes();

function isBoundaryChar(char: string | undefined): boolean {
  return !char || char === "-" || char === "_" || char === "/" || char === ".";
}

function scoreSlashCandidate(candidate: string, query: string): number {
  const lowerCandidate = candidate.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return 0;
  if (lowerCandidate.startsWith(needle)) return 10_000 - lowerCandidate.length;

  let score = 0;
  let searchIndex = 0;
  let consecutive = 0;

  for (const char of needle) {
    const foundIndex = lowerCandidate.indexOf(char, searchIndex);
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

    if (isBoundaryChar(lowerCandidate[foundIndex - 1])) {
      score += 20;
    }

    searchIndex = foundIndex + 1;
  }

  score -= lowerCandidate.length;
  return score;
}

function scoreSlashCommandMatch(command: StandaloneSlashCommand, query: string): number {
  const names = [command.name, ...(command.aliases ?? [])];
  return Math.max(
    ...names.map((name) => scoreSlashCandidate(name, query)),
    Number.NEGATIVE_INFINITY,
  );
}

export function filterStandaloneSlashCommands(value: string): StandaloneSlashCommand[] {
  if (!value.startsWith("/")) return [];
  const rest = value.slice(1);
  if (rest.includes(" ")) return [];
  const query = rest.toLowerCase();
  if (!query) return STANDALONE_SLASH_COMMANDS;

  return STANDALONE_SLASH_COMMANDS
    .map((cmd) => ({ cmd, score: scoreSlashCommandMatch(cmd, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.cmd.name.localeCompare(right.cmd.name))
    .map((entry) => entry.cmd);
}

export function renderStandaloneHelp(): string {
  const supported = STANDALONE_SLASH_COMMANDS.filter((command) => command.supported)
    .map((command) => {
      const alias = command.aliases && command.aliases.length > 0
        ? ` (aliases: ${command.aliases.map((item) => `/${item}`).join(", ")})`
        : "";
      return `/${command.name}${command.args ? ` ${command.args}` : ""} — ${command.description}${alias}`;
    });
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
  return STANDALONE_SLASH_COMMANDS.find(
    (command) => command.name === name || (command.aliases ?? []).includes(name),
  );
}
