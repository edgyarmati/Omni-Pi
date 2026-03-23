import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  createOmniCommands,
  resetRuntimeWorkEngineFactoryForTests,
  setRuntimeWorkEngineFactoryForTests
} from "../src/commands.js";
import { createSubagentWorkEngine } from "../src/subagents.js";
import { initializeOmniProject, planOmniProject } from "../src/workflow.js";
import { prepareNextTaskDispatch } from "../src/work.js";

async function createTempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Omni runtime integration", () => {
  test("omni-init executes planned skill install commands when runtime is available", async () => {
    const rootDir = await createTempProject("omni-runtime-init-");
    const init = createOmniCommands().find((command) => command.name === "omni-init");
    const execCalls: Array<{ command: string; args: string[] }> = [];

    const output = await init?.execute({
      cwd: rootDir,
      runtime: {
        pi: {
          exec: async (command: string, args: string[]) => {
            execCalls.push({ command, args });
            return { stdout: "installed", stderr: "", code: 0, killed: false };
          }
        } as never,
        ctx: {} as never
      }
    });

    const skills = await readFile(path.join(rootDir, ".omni", "SKILLS.md"), "utf8");

    expect(execCalls).toEqual([
      {
        command: "npx",
        args: ["skills", "add", "https://github.com/vercel-labs/skills", "--skill", "find-skills"]
      }
    ]);
    expect(output).toContain("Install find-skills: installed");
    expect(skills).toContain("Install find-skills: installed");
  });

  test("prepareNextTaskDispatch creates a task brief and marks the task in progress", async () => {
    const rootDir = await createTempProject("omni-runtime-dispatch-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: []
    });

    const dispatch = await prepareNextTaskDispatch(rootDir);
    const tasks = await readFile(path.join(rootDir, ".omni", "TASKS.md"), "utf8");

    expect(dispatch.kind).toBe("ready");
    expect(dispatch.taskId).toBe("T01");
    expect(dispatch.prompt).toContain("Task: T01");
    expect(tasks).toContain("| T01 | Confirm the initial project direction | worker | - | in_progress |");
  });

  test("omni-work uses runtime session APIs to prepare a fresh focused session", async () => {
    const rootDir = await createTempProject("omni-runtime-work-");
    await initializeOmniProject(rootDir);
    await planOmniProject(rootDir, {
      summary: "Build the first slice.",
      desiredOutcome: "Build the first slice.",
      constraints: [],
      userSignals: []
    });

    const work = createOmniCommands().find((command) => command.name === "omni-work");
    const drafted: string[] = [];
    const statuses: string[] = [];
    let created = 0;

    setRuntimeWorkEngineFactoryForTests(async () => {
      throw new Error("subagents unavailable in this test");
    });

    try {
      const output = await work?.execute({
        cwd: rootDir,
        runtime: {
          pi: {} as never,
          ctx: {
            sessionManager: {
              getSessionFile: () => "/tmp/current-session.jsonl"
            },
            newSession: async () => {
              created += 1;
              return { cancelled: false };
            },
            ui: {
              setEditorText: (value: string) => {
                drafted.push(value);
              },
              setStatus: (_key: string, value: string | undefined) => {
                if (value) {
                  statuses.push(value);
                }
              },
              notify: () => undefined
            }
          } as never
        }
      });

      expect(created).toBe(1);
      expect(drafted[0]).toContain("Task: T01");
      expect(statuses[0]).toContain("Prepared T01");
      expect(output).toContain("Prepared T01 in a fresh focused session");
    } finally {
      resetRuntimeWorkEngineFactoryForTests();
    }
  });

  test("createSubagentWorkEngine uses pi-subagents-compatible worker and expert runs", async () => {
    const rootDir = await createTempProject("omni-runtime-subagents-");
    await initializeOmniProject(rootDir);

    const calls: Array<{ agent: string; task: string }> = [];
    const engine = await createSubagentWorkEngine(
      rootDir,
      {
        ui: {
          setStatus: () => undefined
        }
      } as never,
      {
        discoverAgents: () => ({
          agents: [
            { name: "omni-worker", systemPrompt: "worker" },
            { name: "omni-expert", systemPrompt: "expert" }
          ]
        }),
        runSync: async (_runtimeCwd, _agents, agentName, task) => {
          calls.push({ agent: agentName, task });
          return {
            agent: agentName,
            exitCode: 0,
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: '{"summary":"done","verification":{"passed":true,"checksRun":["npm test"],"failureSummary":[],"retryRecommended":false}}'
                  }
                ]
              }
            ]
          };
        },
        getFinalOutput: (messages) =>
          (((messages[0] as { content: Array<{ text: string }> }).content[0] as { text: string }).text)
      }
    );

    const workerResult = await engine.runWorkerTask(
      {
        id: "T01",
        title: "Implement feature",
        objective: "Do the thing",
        contextFiles: [],
        skills: [],
        doneCriteria: ["It works"],
        role: "worker",
        status: "todo",
        dependsOn: []
      },
      1
    );

    const expertResult = await engine.runExpertTask(
      {
        id: "T01",
        title: "Implement feature",
        objective: "Do the thing",
        contextFiles: [],
        skills: [],
        doneCriteria: ["It works"],
        role: "worker",
        status: "todo",
        dependsOn: []
      },
      {
        taskId: "T01",
        priorAttempts: 2,
        failureLogs: ["failed twice"],
        expertObjective: "Fix it"
      }
    );

    expect(calls[0].agent).toBe("omni-worker");
    expect(calls[0].task).toContain("You are Omni-Pi's worker executor");
    expect(calls[1].agent).toBe("omni-expert");
    expect(calls[1].task).toContain("You are Omni-Pi's expert executor");
    expect(workerResult.verification.passed).toBe(true);
    expect(expertResult.verification.passed).toBe(true);
  });
});
