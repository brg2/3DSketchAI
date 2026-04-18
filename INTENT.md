# INTENT.md — 3D Sketch AI

## 1. System Definition
3D Sketch AI is a browser-based, open-source 3D modeling system with SketchUp-like direct manipulation.

Required stack from project start:
- Three.js (rendering and interaction)
- Replicad (modeling API layer)
- OpenCascade WASM (exact geometry kernel)

Core rule:
- Users manipulate geometry directly.
- The system maps interactions to feature operations.
- Geometry is produced by replaying the feature graph.

## 2. Source of Truth Separation

### 2.1 Application Development System
Scope: architecture and behavior of the 3D Sketch AI application.

Source of truth: `INTENT.md`.

This document is authoritative for:
- architecture
- interaction behavior
- performance requirements
- product boundaries

### 2.2 Modeling System (User Geometry) — REVISED
Scope: user model state and regeneration.

Source of truth: Feature Graph.

The feature graph:
- is generated from interaction
- fully represents committed operations
- is replayed to produce geometry via Replicad + OpenCascade

Executable TypeScript is no longer the canonical model representation.

## 3. Canonical Model Rule — REVISED
The canonical model is the Feature Graph.

Requirements:
- deterministic replay
- complete representation of committed operations
- independent of transient geometry state

Geometry (BREP/mesh) is a derived artifact and must not be used as source of truth.

Executable TypeScript:
- is an export format only
- must be generated from the feature graph
- must not be edited or treated as authoritative state

## 3.1 Serialization
The system must support:
- Feature Graph -> JSON (primary persistence format)
- Feature Graph -> executable TypeScript (optional export)

Loading a model must:
- reconstruct the feature graph
- replay to generate geometry

No system behavior may depend on TypeScript as input.

## 3.2 Feature Graph Purpose
The Feature Graph is a minimal, deterministic, and reproducible representation of modeling intent.

It is NOT:
- a history log of interactions
- a sequence of raw geometry edits

System rules:
- redundant operations may be collapsed only when safe
- correctness must be preserved over compactness

## 4. Interaction Philosophy
The UI is non-parametric-first.

Users are not required to:
- create sketches
- define constraints
- manage feature trees
- reason about history graphs

Internal parametric structure MUST exist, but it is not exposed in V1 UI.

## 4.1 Internal Modeling Paradigm
Direct manipulation is an input method, not a direct geometry mutation model.

All committed operations must follow:
- interaction -> resolve feature -> validate modification -> modify OR fallback -> deterministic replay -> geometry

Feature graph constraints:
- all committed modeling changes must be represented as features
- users cannot directly edit feature graph internals in V1
- transient geometry is allowed only for preview

## 4.1.1 Safe Feature-Aware Editing Constraint
Feature modification is permitted only when all conditions are true:
- affected geometry maps to a single originating feature
- that feature fully defines the geometry being modified
- modifying feature parameters can reproduce the intended result
- no downstream features conflict with the modification

If any condition fails:
- the system MUST create a new feature
- correctness MUST take priority over minimizing feature count

## 4.1.2 Push/Pull Behavior
Push/pull is a feature-editing operation.

Push/pull must:
- attempt to modify the originating feature first
- accumulate into that feature when safe

Required behavior example:
- Box(height: 10 -> 12 -> 14)

Push/pull may create a new feature only when:
- the originating feature cannot safely represent the change
- downstream operations invalidate safe modification

## 4.1.3 Topology Identity Prohibition
The system MUST NOT use the following as persistent identifiers:
- face indices
- edge indices
- topology ordering

Topology is unstable and must not be used for feature lookup or authoritative identity.

## 4.1.4 Feature-Origin Identity
All geometry produced by a feature MUST carry:
- featureId
- role (semantic label within that feature)

Role rules:
- roles are defined per feature, not globally
- a role may map to multiple faces after topology changes

Feature-origin identity is the primary mechanism for feature lookup.

## 4.1.5 Selector Model
All feature operations that reference geometry MUST use selectors.

Selectors must include:
- featureId (when available)
- role (within that feature)
- geometric hints (approximate point, normal)

Selectors must NOT include:
- topology indices
- world-space coordinates

## 4.1.6 Coordinate Space Rules
The system defines two spaces:
- Feature Space (canonical model space)
- World Space (rendering only)

Rules:
- interaction input is received in world space
- interaction data MUST be transformed into feature/model space before selector construction and feature operations
- feature graph operations run exclusively in feature/model space

Selectors must remain valid under:
- translation
- rotation
- scaling
- grouping

## 4.1.7 Deterministic Feature Resolution Process
Feature resolution must follow:
- selector -> feature-origin match -> role filter -> geometric disambiguation

Resolution order:
1. match featureId
2. match role within feature
3. if multiple candidates, disambiguate by geometric proximity using approximate point
4. fallback to geometric search only when feature-origin identity is unavailable

Resolution requirements:
- deterministic
- stable across replay
- tolerant to topology changes

The system must reliably answer: "Which feature produced this geometry?"

## 4.1.8 Topology Change Handling
The system must support:
- one-to-many face mapping after splits
- many-to-one face mapping after merges

Roles must be interpreted as semantic face groups, not single topology elements.

## 4.1.9 Prohibited Behavior
The following are explicitly disallowed:
- defaulting to feature creation when safe modification is possible
- modifying features without validation
- storing world-space selector data
- using topology indices for persistent identity
- treating the feature graph as a simple operation log

## 4.2 User Representation Model (Clarification)
Users do not interact with:
- feature graphs
- parametric trees
- modeling scripts

Users interact only with geometry via direct manipulation.

The system internally maps these interactions to validated feature modification or explicit feature creation fallback.

## 4.3 History Representation
User-visible history is an Action Timeline, not a feature tree.

Example:

Actions
1. Box
2. Push/Pull Face +1.25
3. Move Object X +2.00

This is a projection of the feature graph for usability.

It must:
- not expose dependency graphs
- not expose internal identifiers
- remain simple and descriptive

## 4.4 Developer Inspection
A developer-only inspector may expose:
- feature graph JSON
- replay order
- feature parameters

This is not part of the user-facing UI.

## 4.5 Representation Visibility
The Feature Graph may be projected into a human-readable representation (for example JSON or a TypeScript-like structure) for inspection.

This projection:
- must update in real time with model changes
- must reflect the current Feature Graph exactly
- must be read-only in the user interface

It must not:
- be editable by users
- be parsed as input
- be treated as authoritative state

The Feature Graph object remains the only source of truth.

## 5. Tooling Scope (V1)
Required tools:
- selection (face, edge, object)
- push/pull
- move
- rotate
- scale
- primitive creation
- grouping and components

Persistence requirement:
- save/load Feature Graph JSON as primary model format
- optional export to executable TypeScript

## 6. Interaction Execution Model
All manipulations use two phases:
1. Interactive Preview Phase
2. Commit Phase

### 6.1 Interactive Preview Phase
During active input:
- do not replay the full feature graph on each event
- do not invoke full CAD-kernel recompute on each event
- maintain a transient operation and continuously update its parameters
- update preview mesh at interactive frame rates

Preview constraints:
- close approximation of commit result
- same semantic parameters as commit operation
- transient and non-authoritative

### 6.2 Commit Phase
On interaction completion:
- resolve feature deterministically using selector -> feature-origin match -> role filter -> geometric disambiguation
- validate safe feature modification constraints
- modify existing feature only when all safety conditions pass; otherwise create a new feature
- update canonical feature graph
- replay feature graph via Replicad + OpenCascade
- replace preview with exact resulting geometry

Commit outcome:
- exact geometry becomes visible
- canonical authority remains the feature graph

### 6.3 Consistency Constraint
Preview and commit must be driven by the same operation parameters to avoid visible discontinuity at commit.

## 7. Representation Model
The runtime maintains:
- display mesh representation for interaction and rendering
- exact kernel geometry for correctness

Rules:
- during interaction, display mesh is preview-driven
- after commit, display mesh is regenerated from exact geometry
- canonical source of truth is the committed feature graph only

## 8. Layered Architecture

### 8.1 View Layer
- Three.js scene graph
- camera and viewport control
- overlays and visual feedback

### 8.2 Interaction Layer
- selection pipeline
- manipulation tool state machines
- minimal snapping and inference for V1
- world-space input capture and transformation into feature/model space

### 8.3 Operation Layer
- interaction-to-feature-operation mapping
- selector construction in feature/model space only
- operation parameter validation
- commit payload construction for feature graph updates

### 8.4 Modeling Layer
- Replicad execution interface
- OpenCascade exact geometry execution

### 8.5 Representation Layer
- display mesh lifecycle management
- exact geometry lifecycle management
- preview/commit synchronization

### 8.6 Serialization and Export Layer
- feature graph JSON persistence
- TypeScript export generation from feature graph

## 9. Performance Requirements
System requirements:
- interaction remains responsive during normal editing load
- preview updates run at interactive frame rates
- kernel execution never occurs on every pointer event
- heavy modeling computation does not block UI interaction

Execution policy:
- keep interaction loop lightweight
- defer/batch expensive recomputes
- run exact geometry recompute asynchronously from input handling

## 10. Open Source and Licensing
Project license: Apache License 2.0.

Repository requirements:
- `LICENSE` with Apache-2.0 text
- `NOTICE` when required
- explicit third-party attribution and license compatibility records

Contribution rule:
- all contributions and dependencies must be Apache-2.0-compatible for redistribution

## 11. Non-Goals (V1)
- parametric-first CAD workflow
- enterprise CAD feature completeness
- mesh sculpting workflow
- AI-first automatic modeling workflow
- proprietary product cloning

## 12. Exclusions (V1)
- feature tree UI
- parametric editing UI
- advanced snapping/inference systems
- AI-driven automatic geometry modifications

## 13. Long-Term Direction
Possible future evolution:
- structured introspection over feature graph operations
- optional parametric editing interfaces above the same model core
- AI-assisted modeling workflows with explicit user control
- live recompute architecture with partial model reevaluation

Not a V1 commitment.

## 14. Design Principles
All architecture and product decisions prioritize:
- interaction first
- minimal latency
- predictable behavior
- direct manipulation over abstraction
- internal feature determinism with simple user-facing interaction

## 15. Intent Governance
`INTENT.md` is the authoritative definition of system intent.

When intent changes, development workflow must:
1. detect semantic deltas
2. derive scoped engineering tasks
3. apply changes in small, targeted updates
4. verify alignment after each update

Change discipline:
- no large destructive rewrites to satisfy intent updates
- preserve clarity, determinism, and architectural separation
