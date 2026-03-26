import { mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildOmniEnvironment,
  buildPiProcessSpec,
  getOmniPackageDir,
  isOmniEntrypointInvocation,
  resolvePiCliPath,
} from "../bin/omni.js";

describe("omni launcher", () => {
  test("getOmniPackageDir points at the repository root", () => {
    expect(path.basename(getOmniPackageDir())).toBe("Omni-Pi");
  });

  test("resolvePiCliPath resolves the installed Pi CLI", () => {
    expect(resolvePiCliPath()).toContain("@mariozechner/pi-coding-agent");
    expect(resolvePiCliPath().endsWith(path.join("dist", "cli.js"))).toBe(true);
  });

  test("buildOmniEnvironment preserves caller environment", () => {
    const env = buildOmniEnvironment({ FOO: "bar" });

    expect(env.FOO).toBe("bar");
    expect(env.PI_PACKAGE_DIR).toBeUndefined();
  });

  test("buildPiProcessSpec launches Node with the Pi CLI and Omni package path", () => {
    const spec = buildPiProcessSpec(["--help"], { TEST_ENV: "1" });

    expect(spec.command).toBe(process.execPath);
    expect(spec.args[0]).toBe(resolvePiCliPath());
    expect(spec.args[1]).toBe("-e");
    expect(spec.args[2]).toBe(getOmniPackageDir());
    expect(spec.args[3]).toBe("--help");
    expect(spec.env.TEST_ENV).toBe("1");
  });

  test("isOmniEntrypointInvocation resolves symlinked global bins", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "omni-launcher-"));
    const symlinkPath = path.join(tempDir, "omni");

    await symlink(
      path.join(getOmniPackageDir(), "bin", "omni.js"),
      symlinkPath,
    );

    expect(isOmniEntrypointInvocation(symlinkPath)).toBe(true);
  });
});
