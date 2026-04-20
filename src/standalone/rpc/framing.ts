import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export type JsonlLineHandler = (line: string) => void;

export function createJsonlLineDecoder(onLine: JsonlLineHandler): {
  push(chunk: Buffer | string): void;
  end(): void;
} {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const emitLine = (line: string) => {
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };

  return {
    push(chunk: Buffer | string) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          return;
        }
        emitLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
      }
    },
    end() {
      buffer += decoder.end();
      if (buffer.length > 0) {
        emitLine(buffer);
        buffer = "";
      }
    },
  };
}

export function attachJsonlLineReader(
  stream: Readable,
  onLine: JsonlLineHandler,
): () => void {
  const decoder = createJsonlLineDecoder(onLine);

  const onData = (chunk: Buffer | string) => decoder.push(chunk);
  const onEnd = () => decoder.end();

  stream.on("data", onData);
  stream.on("end", onEnd);

  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}
