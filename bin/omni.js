#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getOmniPackageDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolvePiCliPath() {
  return path.join(
    getOmniPackageDir(),
    "node_modules",
    "@mariozechner",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
}

export function buildOmniEnvironment(baseEnv = process.env) {
  return {
    ...baseEnv,
  };
}

export function buildPiProcessSpec(
  argv = process.argv.slice(2),
  baseEnv = process.env,
) {
  return {
    command: process.execPath,
    args: [resolvePiCliPath(), "-e", getOmniPackageDir(), ...argv],
    env: buildOmniEnvironment(baseEnv),
  };
}

export async function runOmni(argv = process.argv.slice(2), options = {}) {
  const spec = buildPiProcessSpec(argv, options.env);

  await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: options.cwd ?? process.cwd(),
      env: spec.env,
      stdio: "inherit",
    });

    const forwardSignal = (sig) => child.kill(sig);
    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    child.on("exit", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);

      if (signal) {
        reject(new Error(`omni terminated with signal ${signal}`));
        return;
      }

      process.exitCode = code ?? 0;
      resolve(code ?? 0);
    });
    child.on("error", (err) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      reject(err);
    });
  });
}

export function isOmniEntrypointInvocation(
  argvPath = process.argv[1],
  moduleUrl = import.meta.url,
) {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return path.resolve(argvPath) === fileURLToPath(moduleUrl);
  }
}

if (isOmniEntrypointInvocation()) {
  runOmni().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
