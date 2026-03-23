import { OMNI_DIR } from "./contracts.js";

export interface StarterFile {
  path: string;
  content: string;
}

export const starterFiles: StarterFile[] = [
  {
    path: `${OMNI_DIR}/PROJECT.md`,
    content: `# Project

## Goal

Describe what this project should achieve.

## Users

- Primary users:
- Secondary users:

## Constraints

- Technical constraints:
- Product constraints:

## Success Criteria

- What does success look like?
`
  },
  {
    path: `${OMNI_DIR}/IDEAS.md`,
    content: `# Ideas

## Active ideas

-

## Future ideas

-

## Parking lot

-
`
  },
  {
    path: `${OMNI_DIR}/DECISIONS.md`,
    content: `# Decisions

Record important choices here as the project evolves.

## Entries

- Date: YYYY-MM-DD
  - Decision:
  - Why:
  - Impact:
`
  },
  {
    path: `${OMNI_DIR}/STATE.md`,
    content: `# State

Current Phase: Understand
Active Task: None
Status Summary: Project initialized. Ready to capture goals and constraints.
Blockers: None
Next Step: Run /omni-plan after the initial project details are captured.
`
  },
  {
    path: `${OMNI_DIR}/SKILLS.md`,
    content: `# Skills

## Installed

- None yet

## Recommended

- None yet

## Deferred

- None yet

## Rejected

- None yet

## Usage Notes

- Record why a skill was installed, recommended, or skipped.
`
  },
  {
    path: `${OMNI_DIR}/SPEC.md`,
    content: `# Spec

## Problem

## Solution shape

## Key workflows

## Risks

## Open questions
`
  },
  {
    path: `${OMNI_DIR}/TASKS.md`,
    content: `# Tasks

## Task slices

| ID | Title | Role | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- | --- |
`
  },
  {
    path: `${OMNI_DIR}/TESTS.md`,
    content: `# Tests

## Project-wide checks

-

## Task-specific checks

-

## Retry policy

- Worker retries before expert takeover: 2

## Escalation threshold

- Escalate after repeated failures or when the planner marks the task as high-risk.
`
  },
  {
    path: `${OMNI_DIR}/SESSION-SUMMARY.md`,
    content: `# Session Summary

## Current understanding

-

## Recent progress

-

## Next handoff notes

-
`
  },
  {
    path: `${OMNI_DIR}/research/README.md`,
    content: `# Research

Store external research summaries and package notes here.
`
  },
  {
    path: `${OMNI_DIR}/specs/README.md`,
    content: `# Specs

Store versioned detailed specs here.
`
  },
  {
    path: `${OMNI_DIR}/tasks/README.md`,
    content: `# Task Artifacts

Store per-task briefs, outputs, and failure histories here.
`
  },
  {
    path: `.pi/agents/omni-worker.md`,
    content: `---
name: omni-worker
description: Omni-Pi worker for bounded implementation tasks
model: anthropic/claude-sonnet-4-5
tools: read, grep, find, ls, bash, edit, write
skill: omni-execution, omni-verification
---

You are Omni-Pi's worker subagent.

Complete the assigned task directly, keep the scope tight, run the required checks when possible, and end with JSON only using this schema:

{"summary":"...","verification":{"passed":true,"checksRun":["..."],"failureSummary":[],"retryRecommended":false}}
`
  },
  {
    path: `.pi/agents/omni-expert.md`,
    content: `---
name: omni-expert
description: Omni-Pi expert for escalated implementation tasks
model: anthropic/claude-opus-4-1
tools: read, grep, find, ls, bash, edit, write
skill: omni-escalation, omni-verification
---

You are Omni-Pi's expert subagent.

Take over difficult or repeatedly failing tasks, fix the root cause, run the required checks when possible, and end with JSON only using this schema:

{"summary":"...","verification":{"passed":true,"checksRun":["..."],"failureSummary":[],"retryRecommended":false}}
`
  }
];
