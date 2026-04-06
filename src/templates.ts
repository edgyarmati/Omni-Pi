import { OMNI_DIR } from "./contracts.js";

export interface StarterFile {
  path: string;
  content: string;
}

export const starterFiles: StarterFile[] = [
  {
    path: `${OMNI_DIR}/VERSION`,
    content: `1
`,
  },
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
`,
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
`,
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
`,
  },
  {
    path: `${OMNI_DIR}/STANDARDS.md`,
    content: `# Imported Standards

These standards were imported from other harness-specific instruction files and approved for Omni use.

No imported standards have been accepted yet.
`,
  },
  {
    path: `${OMNI_DIR}/STATE.md`,
    content: `# State

Current Phase: Understand
Active Task: None
Status Summary: Project initialized. Ready to interview the user and capture exact requirements.
Blockers: None
Next Step: Interview the user, write the exact spec into .omni/, then implement the first bounded slice.
`,
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
`,
  },
  {
    path: `${OMNI_DIR}/project-skills/README.md`,
    content: `# Project Skills

Store project-scoped skills that Omni auto-installs or creates for active tasks here.
`,
  },
  {
    path: `${OMNI_DIR}/SKILLS-STATE.json`,
    content: `{
  "managed": []
}
`,
  },
  {
    path: `${OMNI_DIR}/SPEC.md`,
    content: `# Spec

## Problem

## Solution shape

## Key workflows

## Risks

## Open questions
`,
  },
  {
    path: `${OMNI_DIR}/TASKS.md`,
    content: `# Tasks

## Task slices

| ID | Title | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- |
`,
  },
  {
    path: `${OMNI_DIR}/TESTS.md`,
    content: `# Tests

## Project-wide checks

-

## Task-specific checks

-

## Retry policy

- Implementation retries before the plan must be tightened: 2

## Recovery rule

- If the same slice fails repeatedly, rewrite the slice, clarify the spec, and retry with a narrower plan.
`,
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
`,
  },
  {
    path: `${OMNI_DIR}/PROGRESS.md`,
    content: `# Progress

Ongoing log of project progress.

`,
  },
  {
    path: `${OMNI_DIR}/plans/INDEX.md`,
    content: `# Plan Index

| ID | Title | Status | Created | Completed |
| --- | --- | --- | --- | --- |
`,
  },
  {
    path: `${OMNI_DIR}/research/README.md`,
    content: `# Research

Store external research summaries and package notes here.
`,
  },
  {
    path: `${OMNI_DIR}/specs/README.md`,
    content: `# Specs

Store versioned detailed specs here.
`,
  },
  {
    path: `${OMNI_DIR}/tasks/README.md`,
    content: `# Task Artifacts

Store per-task briefs, outputs, and failure histories here.
`,
  },
  {
    path: `.pi/agents/omni-brain.md`,
    content: `---
name: omni-brain
description: Omni-Pi brain for user-facing interviewing, planning, and implementation
model: anthropic/claude-opus-4-6
tools: read, grep, find, ls, bash
skill: omni-planning, omni-execution, omni-verification
---

You are Omni-Pi's only user-facing agent.

Interview the user until the requested behavior, constraints, and success criteria are concrete enough to implement safely.
Write the evolving project intent into .omni/PROJECT.md and .omni/SPEC.md.
Break the work into bounded slices in .omni/TASKS.md before editing code.
Run the planned checks, record outcomes in .omni/STATE.md and .omni/SESSION-SUMMARY.md, and tighten the plan if a slice fails.
`,
  },
];
