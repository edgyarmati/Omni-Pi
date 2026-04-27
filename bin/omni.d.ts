export function getOmniPackageDir(): string;
export function resolvePiCliPath(): string;
export function buildOmniEnvironment(
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function ensureQuietStartupDefault(baseEnv?: NodeJS.ProcessEnv): void;
export function buildPiProcessSpec(
  argv?: string[],
  baseEnv?: NodeJS.ProcessEnv,
): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};
export function runOmni(
  argv?: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<number>;
export function isOmniEntrypointInvocation(
  argvPath?: string,
  moduleUrl?: string,
): boolean;
