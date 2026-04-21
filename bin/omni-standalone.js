#!/usr/bin/env bun

import { runStandaloneApp } from "../src/standalone/run.ts";

runStandaloneApp().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
