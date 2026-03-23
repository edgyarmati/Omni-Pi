import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

export interface AppCommandContext {
  cwd: string;
  args?: string[];
  runtime?: {
    pi: ExtensionAPI;
    ctx: ExtensionCommandContext;
  };
}

export interface AppCommandDefinition {
  name: string;
  description: string;
  execute: (context: AppCommandContext) => Promise<string>;
}

function splitArgs(rawArgs: string): string[] {
  const trimmed = rawArgs.trim();
  return trimmed.length > 0 ? trimmed.split(/\s+/u) : [];
}

async function emitResult(result: string, ctx: ExtensionCommandContext): Promise<void> {
  if (result.trim().length === 0) {
    return;
  }

  if (ctx.hasUI) {
    ctx.ui.notify(result, "info");
  } else {
    console.log(result);
  }
}

export function registerOmniMessageRenderer(api: ExtensionAPI): void {
  api.registerMessageRenderer("omni-update", (message, { expanded }, theme) => {
    const body = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const details = (message.details ?? {}) as { title?: string };
    const lines = [theme.fg("accent", theme.bold(details.title ?? "Omni-Pi")), body];
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(expanded ? lines.join("\n\n") : lines.join("\n"), 0, 0));
    return box;
  });
}

export function registerPiCommands(api: ExtensionAPI, commands: AppCommandDefinition[]): void {
  for (const command of commands) {
    api.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        const result = await command.execute({
          cwd: ctx.cwd,
          args: splitArgs(args),
          runtime: {
            pi: api,
            ctx
          }
        });
        if (result.trim().length > 0 && ctx.hasUI) {
          api.sendMessage({
            customType: "omni-update",
            content: result,
            display: true,
            details: { title: command.name }
          });
        } else {
          await emitResult(result, ctx);
        }
      }
    });
  }
}
