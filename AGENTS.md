# AGENTS.md

## Core Principle

This project is intent-driven. `INTENT.md` is the authoritative source for application behavior, architecture, product boundaries, and direction. The codebase is the implementation and must be changed to match intent, never the reverse.

Agents must not modify, regenerate, reinterpret, or redefine `INTENT.md`. Treat it as read-only input controlled by external intent-authoring processes.

## Single Source of Truth

The canonical model script (TypeScript) is the absolute, singular source of truth for the model's geometry and history.

- Modeling must be purely parametric and derived from the execution of the model script.
- No parallel object descriptors, state-replay mechanisms, or secondary geometry definitions are allowed for modeling.
- The application must always execute the model script through the BREP kernel (Replicad/OpenCascade) to produce the exact geometry.
- If the kernel is unavailable or execution fails, the application should report the error rather than falling back to an approximate state-based model.

## Orchestration Workflow

When `INTENT.md` changes:

1. Diff `INTENT.md` against the base of the current git branch.
2. Ignore formatting-only changes.
3. Convert semantic deltas into a structured list: change, affected area, expected outcome.
4. Derive atomic, scoped engineering tasks mapped to concrete code areas.
5. Execute tasks with minimal, targeted, reversible changes.
6. Verify code, architecture, and behavior align with intent.
7. Commit only after all derived tasks are complete and verification passes.

Do not create partial commits for an orchestration cycle. The final commit must include the triggering `INTENT.md` change and all required implementation changes. After commit, treat that state as the new baseline.

## Execution Rules

Agents must use tools to inspect the repo before changing it. For each task:

- understand the task and relevant intent
- identify affected files
- make a brief plan before edits
- read only necessary code
- apply focused changes
- avoid unrelated refactors
- verify the result

Agents must not assume codebase behavior without tool use, rewrite broad areas without intent requirement, or introduce speculative features.

If dependencies exist, complete prerequisites first. If blocked, report the issue clearly and avoid unsafe guesses.

## Canonical Model Script Rule

The user's model script must be executable TypeScript made only of real callable modeling code.

Agents must not:

- encode canonical model behavior in comments
- parse comments into modeling actions
- serialize hidden operation metadata into comments
- introduce custom model-script sublanguages
- inline generated helper implementations into the user's model script

Every committed modeling behavior must appear as a direct function or method call. If Replicad does not expose a needed primitive directly, implement the callable pattern in the 3DSAI modeling library outside the user's model script, then emit a direct call to that library from the script.

## Geometry Editing Override (Replicad / BREP)

This section overrides any conflicting modeling behavior elsewhere.

Geometry must not be modified using transforms. Treat all shapes as immutable BREP solids. Shape-changing operations are allowed only through:

- extrusion
- boolean operations: `fuse`, `cut`

Forbidden for shape editing:

- `scale()`
- `translate()` when used to resize or simulate face movement
- `transform()`
- direct vertex edits
- direct face movement

`translate()` and `rotate()` are allowed only for rigid object movement or positioning tool geometry for booleans. They must not change proportions or dimensions.

Any operation involving moving a face, resizing one side, extending a feature, or shrinking a feature must use extrusion plus boolean:

```js
function pushPull(shape, faceIndex, distance) {
  const face = shape.faces()[faceIndex]
  const wire = face.outerWire()
  const tool = wire.extrude(distance)

  return distance > 0
    ? shape.fuse(tool)
    : shape.cut(tool)
}
```

If shape editing is implemented with transform-based resizing, direct vertex movement, or direct face movement, the solution is incorrect.

## Task Quality

Tasks must be atomic, unambiguous, and tied to intent. Valid examples:

- implement push-pull preview system
- refactor interaction layer for transient operations
- add operation generation for extrusion

Invalid examples:

- vague work
- broad multi-feature efforts
- speculative improvements not defined by intent

Completion requires:

- code reflects the intent change
- architecture remains aligned
- unrelated areas are untouched
- verification passes

## Loop Prevention

Do not treat agent-generated code changes as intent changes. Do not re-run completed tasks unless `INTENT.md` changes semantically. Avoid repeated edits to the same area without new intent.

## Scope

Agents are responsible for application architecture, interaction systems, and modeling pipeline integration.

Agents are not responsible for modifying `INTENT.md`, redefining system intent, or introducing unrelated features.
