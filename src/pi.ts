export interface CommandContext {
  cwd: string;
  args?: string[];
}

export interface CommandDefinition {
  name: string;
  description: string;
  execute: (context: CommandContext) => Promise<string>;
}

export interface ExtensionApi {
  registerCommand: (name: string, definition: Omit<CommandDefinition, "name">) => void;
}

export function registerCommands(api: ExtensionApi, commands: CommandDefinition[]): void {
  for (const command of commands) {
    api.registerCommand(command.name, {
      description: command.description,
      execute: command.execute
    });
  }
}
