import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isOmniRpcEvent,
  isOmniRpcResponse,
  type OmniRpcCommand,
  type OmniRpcEvent,
  type OmniRpcExtensionUiRequest,
  type OmniRpcExtensionUiResponse,
  type OmniRpcResponse,
} from "./contracts.js";
import { attachJsonlLineReader, serializeJsonLine } from "./framing.js";

export interface OmniRpcClientOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  additionalArgs?: string[];
  spawnImpl?: typeof spawn;
  responseTimeoutMs?: number;
  startupTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (response: OmniRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface OmniRpcClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isRunning(): boolean;
  send<TResponse extends OmniRpcResponse = OmniRpcResponse>(
    command: OmniRpcCommand,
  ): Promise<TResponse>;
  prompt(
    message: string,
    options?: { streamingBehavior?: "steer" | "followUp" },
  ): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  newSession(): Promise<void>;
  switchSession(sessionPath: string): Promise<void>;
  fork(entryId: string): Promise<void>;
  compact(customInstructions?: string): Promise<{ summary?: string; firstKeptEntryId?: string; tokensBefore?: number } | undefined>;
  getSessionStats(): Promise<Record<string, unknown> | undefined>;
  getCommands(): Promise<Array<{ name?: string; description?: string; source?: string }> | undefined>;
  getAvailableModels(): Promise<Array<{ provider?: string; id?: string; name?: string }> | undefined>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  setSessionName(name: string): Promise<void>;
  abort(): Promise<void>;
  sendExtensionUiResponse(response: OmniRpcExtensionUiResponse): Promise<void>;
  onEvent(listener: (event: OmniRpcEvent) => void): () => void;
  onExtensionUiRequest(
    listener: (request: OmniRpcExtensionUiRequest) => void,
  ): () => void;
  getStderr(): string;
}

function getOmniPackageDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function resolvePiCliPath(): string {
  return path.join(
    getOmniPackageDir(),
    "node_modules",
    "@mariozechner",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
}

export function createOmniRpcClient(
  options: OmniRpcClientOptions = {},
): OmniRpcClient {
  const spawnImpl = options.spawnImpl ?? spawn;
  const responseTimeoutMs = options.responseTimeoutMs ?? 30_000;
  const startupTimeoutMs = options.startupTimeoutMs ?? 5_000;

  let child: ChildProcessWithoutNullStreams | null = null;
  let stopReadingStdout: (() => void) | null = null;
  let requestCounter = 0;
  let stderr = "";
  const pendingRequests = new Map<string, PendingRequest>();
  const eventListeners = new Set<(event: OmniRpcEvent) => void>();
  const extensionUiListeners = new Set<
    (request: OmniRpcExtensionUiRequest) => void
  >();

  const clearPendingRequests = (error: Error) => {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingRequests.clear();
  };

  const handleParsedMessage = (value: unknown) => {
    if (isOmniRpcResponse(value)) {
      const response = value;
      const id = response.id;
      if (id && pendingRequests.has(id)) {
        const pending = pendingRequests.get(id);
        pendingRequests.delete(id);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(response);
        }
      }
      return;
    }

    if (!isOmniRpcEvent(value)) {
      return;
    }

    const event = value;
    if (event.type === "extension_ui_request") {
      const request = event as OmniRpcExtensionUiRequest;
      for (const listener of extensionUiListeners) {
        listener(request);
      }
      return;
    }

    for (const listener of eventListeners) {
      listener(event);
    }
  };

  const writeCommand = async (command: OmniRpcCommand): Promise<void> => {
    if (!child?.stdin) {
      throw new Error("RPC client is not running");
    }

    const payload = serializeJsonLine(command);
    await new Promise<void>((resolve, reject) => {
      child?.stdin.write(payload, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  const start = async (): Promise<void> => {
    if (child) {
      throw new Error("RPC client already started");
    }

    stderr = "";
    const args = [
      resolvePiCliPath(),
      "-e",
      getOmniPackageDir(),
      "--mode",
      "rpc",
      ...(options.additionalArgs ?? []),
    ];

    child = spawnImpl(process.execPath, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    stopReadingStdout = attachJsonlLineReader(child.stdout, (line) => {
      try {
        handleParsedMessage(JSON.parse(line));
      } catch {
        // Ignore malformed/non-JSON lines from the engine stream.
      }
    });

    child.on("exit", (code, signal) => {
      stopReadingStdout?.();
      stopReadingStdout = null;
      child = null;
      clearPendingRequests(
        new Error(
          `Pi RPC process exited${
            signal ? ` with signal ${signal}` : ` with code ${code ?? 0}`
          }.${stderr ? ` Stderr: ${stderr}` : ""}`,
        ),
      );
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out starting Pi RPC process.${
              stderr ? ` Stderr: ${stderr}` : ""
            }`,
          ),
        );
      }, startupTimeoutMs);

      child?.once("spawn", () => {
        clearTimeout(timer);
        resolve();
      });
      child?.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  };

  const stop = async (): Promise<void> => {
    if (!child) {
      return;
    }

    const currentChild = child;
    stopReadingStdout?.();
    stopReadingStdout = null;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        currentChild.kill("SIGKILL");
        resolve();
      }, 1_000);

      currentChild.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      currentChild.kill("SIGTERM");
    });
  };

  const restart = async (): Promise<void> => {
    await stop();
    await start();
  };

  const send = async <TResponse extends OmniRpcResponse = OmniRpcResponse>(
    command: OmniRpcCommand,
  ): Promise<TResponse> => {
    if (!child) {
      throw new Error("RPC client is not running");
    }

    const id = `omni-rpc-${++requestCounter}`;
    const responsePromise = new Promise<OmniRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(
          new Error(
            `Timed out waiting for RPC response to ${command.type}.${
              stderr ? ` Stderr: ${stderr}` : ""
            }`,
          ),
        );
      }, responseTimeoutMs);

      pendingRequests.set(id, { resolve, reject, timer });
    });

    await writeCommand({ ...command, id });
    return (await responsePromise) as TResponse;
  };

  const prompt = async (
    message: string,
    options?: { streamingBehavior?: "steer" | "followUp" },
  ): Promise<void> => {
    const response = await send({
      type: "prompt",
      message,
      ...(options?.streamingBehavior
        ? { streamingBehavior: options.streamingBehavior }
        : {}),
    });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const steer = async (message: string): Promise<void> => {
    const response = await send({ type: "steer", message });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const followUp = async (message: string): Promise<void> => {
    const response = await send({ type: "follow_up", message });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const newSession = async (): Promise<void> => {
    const response = await send({ type: "new_session" });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const switchSession = async (sessionPath: string): Promise<void> => {
    const response = await send({ type: "switch_session", sessionPath });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const fork = async (entryId: string): Promise<void> => {
    const response = await send({ type: "fork", entryId });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const compact = async (
    customInstructions?: string,
  ): Promise<{ summary?: string; firstKeptEntryId?: string; tokensBefore?: number } | undefined> => {
    const response = await send<OmniRpcResponse<{ summary?: string; firstKeptEntryId?: string; tokensBefore?: number }>>(
      customInstructions
        ? { type: "compact", customInstructions }
        : { type: "compact" },
    );
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  };

  const getSessionStats = async (): Promise<Record<string, unknown> | undefined> => {
    const response = await send<OmniRpcResponse<Record<string, unknown>>>({
      type: "get_session_stats",
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  };

  const getCommands = async (): Promise<Array<{ name?: string; description?: string; source?: string }> | undefined> => {
    const response = await send<OmniRpcResponse<{ commands?: Array<{ name?: string; description?: string; source?: string }> }>>({
      type: "get_commands",
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data?.commands;
  };

  const getAvailableModels = async (): Promise<Array<{ provider?: string; id?: string; name?: string }> | undefined> => {
    const response = await send<OmniRpcResponse<{ models?: Array<{ provider?: string; id?: string; name?: string }> }>>({
      type: "get_available_models",
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data?.models;
  };

  const setModel = async (provider: string, modelId: string): Promise<void> => {
    const response = await send({ type: "set_model", provider, modelId });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const setThinkingLevel = async (level: string): Promise<void> => {
    const response = await send({ type: "set_thinking_level", level });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const setSessionName = async (name: string): Promise<void> => {
    const response = await send({ type: "set_session_name", name });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const abort = async (): Promise<void> => {
    const response = await send({ type: "abort" });
    if (!response.success) {
      throw new Error(response.error);
    }
  };

  const sendExtensionUiResponse = async (
    response: OmniRpcExtensionUiResponse,
  ): Promise<void> => {
    await writeCommand(response as unknown as OmniRpcCommand);
  };

  const onEvent = (listener: (event: OmniRpcEvent) => void): (() => void) => {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  };

  const onExtensionUiRequest = (
    listener: (request: OmniRpcExtensionUiRequest) => void,
  ): (() => void) => {
    extensionUiListeners.add(listener);
    return () => {
      extensionUiListeners.delete(listener);
    };
  };

  return {
    start,
    stop,
    restart,
    isRunning: () => child !== null,
    send,
    prompt,
    steer,
    followUp,
    newSession,
    switchSession,
    fork,
    compact,
    getSessionStats,
    getCommands,
    getAvailableModels,
    setModel,
    setThinkingLevel,
    setSessionName,
    abort,
    sendExtensionUiResponse,
    onEvent,
    onExtensionUiRequest,
    getStderr: () => stderr,
  };
}
