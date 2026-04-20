import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, test, vi } from "vitest";
import {
  createOmniRpcClient,
  type OmniRpcClientOptions,
} from "../src/standalone/rpc/client.js";
import type { OmniRpcCommand } from "../src/standalone/rpc/contracts.js";
import {
  attachJsonlLineReader,
  createJsonlLineDecoder,
  serializeJsonLine,
} from "../src/standalone/rpc/framing.js";

function createSpawnStub() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const child = new EventEmitter() as unknown as ReturnType<
    NonNullable<OmniRpcClientOptions["spawnImpl"]>
  >;

  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    kill: vi.fn((signal?: NodeJS.Signals | number) => {
      setImmediate(() => {
        (child as unknown as EventEmitter).emit(
          "exit",
          signal === "SIGKILL" ? 137 : 0,
          signal ?? null,
        );
      });
      return true;
    }),
  });

  const spawnImpl: NonNullable<OmniRpcClientOptions["spawnImpl"]> = vi.fn(
    () => {
      setImmediate(() => {
        (child as unknown as EventEmitter).emit("spawn");
      });
      return child;
    },
  ) as NonNullable<OmniRpcClientOptions["spawnImpl"]>;

  return { child, stdin, stdout, stderr, spawnImpl };
}

describe("standalone RPC framing", () => {
  test("serializeJsonLine emits LF-delimited JSON", () => {
    expect(serializeJsonLine({ hello: "world" })).toBe('{"hello":"world"}\n');
  });

  test("decoder splits on LF only and preserves unicode separators inside JSON strings", () => {
    const lines: string[] = [];
    const decoder = createJsonlLineDecoder((line) => lines.push(line));

    decoder.push('{"text":"hello\u2028world"}\n{"text":"second"}');
    expect(lines).toEqual(['{"text":"hello\u2028world"}']);

    decoder.end();
    expect(lines).toEqual(['{"text":"hello\u2028world"}', '{"text":"second"}']);
  });

  test("reader strips trailing carriage returns for CRLF input", () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    const detach = attachJsonlLineReader(stream, (line) => lines.push(line));

    stream.write('{"a":1}\r\n{"b":2}\n');
    stream.end();
    detach();

    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("standalone RPC client", () => {
  test("sends correlated commands and resolves responses", async () => {
    const { stdin, stdout, spawnImpl } = createSpawnStub();
    const client = createOmniRpcClient({ spawnImpl, cwd: process.cwd() });
    const writes: string[] = [];

    stdin.on("data", (chunk) => {
      writes.push(chunk.toString("utf8"));
      const command = JSON.parse(chunk.toString("utf8")) as OmniRpcCommand;
      stdout.write(
        serializeJsonLine({
          id: command.id,
          type: "response",
          command: command.type,
          success: true,
          data: { ok: true },
        }),
      );
    });

    await client.start();
    const response = await client.send({ type: "get_state" });

    expect(response.success).toBe(true);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}").type).toBe("get_state");

    await client.stop();
  });

  test("reads available models for standalone selectors", async () => {
    const { stdin, stdout, spawnImpl } = createSpawnStub();
    const client = createOmniRpcClient({ spawnImpl, cwd: process.cwd() });

    stdin.on("data", (chunk) => {
      const command = JSON.parse(chunk.toString("utf8")) as OmniRpcCommand;
      stdout.write(
        serializeJsonLine({
          id: command.id,
          type: "response",
          command: command.type,
          success: true,
          data: {
            models: [
              { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
            ],
          },
        }),
      );
    });

    await client.start();
    await expect(client.getAvailableModels()).resolves.toEqual([
      { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
    ]);
    await client.stop();
  });

  test("routes extension UI requests separately from normal events", async () => {
    const { stdout, spawnImpl } = createSpawnStub();
    const client = createOmniRpcClient({ spawnImpl, cwd: process.cwd() });
    const events: string[] = [];
    const uiMethods: string[] = [];

    client.onEvent((event) => events.push(event.type));
    client.onExtensionUiRequest((request) => uiMethods.push(request.method));

    await client.start();

    stdout.write(
      serializeJsonLine({
        type: "queue_update",
        steering: ["one"],
        followUp: [],
      }),
    );
    stdout.write(
      serializeJsonLine({
        type: "extension_ui_request",
        id: "ui-1",
        method: "setWidget",
        widgetKey: "omni",
        widgetLines: ["hello"],
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual(["queue_update"]);
    expect(uiMethods).toEqual(["setWidget"]);

    await client.stop();
  });

  test("rejects pending requests if the process exits", async () => {
    const { child, stdin, spawnImpl } = createSpawnStub();
    const client = createOmniRpcClient({
      spawnImpl,
      cwd: process.cwd(),
      responseTimeoutMs: 500,
    });

    stdin.on("data", () => {
      setImmediate(() => {
        (child as unknown as EventEmitter).emit("exit", 1, null);
      });
    });

    await client.start();

    await expect(client.send({ type: "get_state" })).rejects.toThrow(/exited/i);
  });
});
