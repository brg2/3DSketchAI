# AGENTS.md

## Purpose

The agent system maintains alignment between the codebase and `INTENT.md`.

`INTENT.md` is the source of truth for behavior, architecture, and direction.

Agents must interpret intent changes and apply corresponding code changes.

## System Role

The system acts as orchestrator and executor.

Workflow:

1. Detect changes in `INTENT.md`
2. Compute diff against the base of the current git branch
3. Interpret semantic meaning of the diff
4. Derive actionable engineering tasks
5. Execute tasks through specialized agents
6. Verify resulting code aligns with intent

## Source of Truth

- `INTENT.md` defines system intent
- The codebase is an implementation that must align with `INTENT.md`
- If discrepancies exist, update the codebase to match intent

Agents must not preserve conflicting code.

## Canonical Model Script Rule

The user's model script must be executable TypeScript made only of real callable modeling code.

Agents must not:

- encode canonical model behavior in comments
- parse comments into modeling actions
- serialize hidden operation metadata into comments
- introduce custom model-script sublanguages
- inline generated helper implementations into the user's model script

Every committed modeling behavior must appear as a direct function or method call. If Replicad does not expose a needed primitive directly, implement the callable pattern in the 3DSAI modeling library outside the user's model script, then emit a direct call to that library from the script.

## Intent File Protection

`INTENT.md` is read-only for all agents.

Agents must not:

- modify `INTENT.md`
- generate changes to `INTENT.md`
- reinterpret or redefine intent
- change intent to fit existing code

`INTENT.md` may only be modified by external intent-authoring processes.

Agents must treat `INTENT.md` as input only.

## Intent Diffing

When `INTENT.md` changes:

- compute diff against the base of the current git branch
- identify semantic changes
- ignore formatting-only changes

Transform the diff into a structured list of intent changes.

Each intent change must state:

- what was added, removed, or modified
- the affected system area
- the expected outcome

## Task Derivation

Derive tasks from interpreted intent changes.

Each task must:

- be atomic and scoped
- map to a specific codebase area
- define a concrete implementation change
- avoid ambiguity

Valid examples:

- implement push-pull preview system
- refactor interaction layer for transient operations
- add operation generation for extrusion

Invalid tasks:

- vague or unclear work
- large multi-feature efforts
- speculative improvements not defined by intent

## Agent Orchestration

The system must spawn agents to execute tasks.

Rules:

- one agent per task or small related task group
- agents run independently unless dependencies require ordering
- tasks may run sequentially or in parallel

Orchestrator responsibilities:

- assign tasks
- track execution
- ensure completion

## Execution Model

Each agent must:

1. Understand assigned task
2. Identify relevant code areas
3. Read only necessary files
4. Plan change before writing code
5. Apply minimal focused modifications
6. Verify alignment with `INTENT.md`

Agents must not:

- rewrite large code areas without intent requirement
- modify unrelated areas
- introduce speculative changes

## Tooling Expectations

Agents must use tools to operate on the codebase.

Required capabilities:

- search relevant code
- open and read files
- write or modify files
- inspect project structure

Agents must not assume full codebase knowledge without tool use.

## Planning Requirement

Before making changes, each agent must:

- produce a brief plan
- identify affected files
- outline intended modifications

Execution must follow the plan.

## Change Constraints

All changes must be:

- minimal
- targeted
- reversible

Large or destructive changes are disallowed unless explicitly required by intent.

## Dependency Handling

If task dependencies exist:

- establish execution order
- complete prerequisites first

Agents must not execute dependent tasks before prerequisites complete.

## Completion Criteria

A task is complete only when:

- code reflects the intent change
- modification aligns with system architecture
- no unrelated system areas are affected

## Commit and Baseline Finalization

Git commit is required to finalize an orchestration cycle.

Rules:

- do not create a commit until all derived tasks are complete
- do not create partial commits for a subset of orchestration tasks
- include `INTENT.md` intent changes that triggered the cycle in the same commit
- include all code changes required to satisfy those intent changes in the same commit
- create the commit only after alignment verification passes

After commit:

- treat the committed state as the new baseline for future intent diffing
- on a subsequent `INTENT.md` change, start a new orchestration cycle from that new baseline
- do not re-derive or re-execute previously completed tasks unless new semantic intent changes require it

## Failure Handling

If an agent cannot complete a task, it must:

- report failure clearly
- describe the blocking issue
- avoid unsafe or speculative fixes

## Loop Prevention

To prevent infinite loops:

- ignore agent-generated code changes as intent re-trigger signals
- do not re-run tasks unless `INTENT.md` changes semantically
- avoid repeated edits to the same area without new intent change

## Scope Boundaries

Agents are responsible for:

- application architecture
- interaction systems
- modeling pipeline integration

Agents are not responsible for:

- modifying `INTENT.md`
- redefining system intent
- introducing unrelated features

## System Principle

The system is intent-driven.

Agents translate intent into implementation.

The objective is continuous alignment between:

- intent
- code
- behavior
