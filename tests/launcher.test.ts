import path from "node:path";

import { describe, expect, test } from "vitest";

import { buildOmniEnvironment, buildPiProcessSpec, getOmniPackageDir, resolvePiCliPath } from "../bin/omni.js";

describe("omni launcher", () => {
  test("getOmniPackageDir points at the repository root", () => {
    expect(path.basename(getOmniPackageDir())).toBe("Omni-Pi");
  });

  test("resolvePiCliPath resolves the installed Pi CLI", () => {
    expect(resolvePiCliPath()).toContain("@mariozechner/pi-coding-agent");
    expect(resolvePiCliPath().endsWith(path.join("dist", "cli.js"))).toBe(true);
  });

  test("buildOmniEnvironment sets PI_PACKAGE_DIR", () => {
    const env = buildOmniEnvironment({ FOO: "bar" });

    expect(env.FOO).toBe("bar");
    expect(env.PI_PACKAGE_DIR).toBe(getOmniPackageDir());
  });

  test("buildPiProcessSpec launches Node with the Pi CLI and forwarded args", () => {
    const spec = buildPiProcessSpec(["--help"], { TEST_ENV: "1" });

    expect(spec.command).toBe(process.execPath);
    expect(spec.args[0]).toBe(resolvePiCliPath());
    expect(spec.args[1]).toBe("--help");
    expect(spec.env.PI_PACKAGE_DIR).toBe(getOmniPackageDir());
    expect(spec.env.TEST_ENV).toBe("1");
  });
});
