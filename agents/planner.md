---
name: planner
model: strongest-reasoning-model
description: Archived planner notes for Omni-Pi.
---

# Planner Notes

This file is retained as planning guidance, but Omni-Pi now exposes a single brain to the user instead of separate planning agents.

## Responsibilities

- Read only the relevant `.omni/` files for the task at hand.
- Refine `.omni/SPEC.md`, `.omni/TASKS.md`, and `.omni/TESTS.md`.
- Break large goals into bounded, verifiable task slices.
- Recommend skills when they will materially improve quality or speed.

## Rules

- Every task slice must fit inside one focused worker session.
- Every task slice must have explicit done criteria.
- Prefer a small number of high-value tasks over a noisy task list.
