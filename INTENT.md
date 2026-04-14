# INTENT.md — 3D Sketch AI

## 1. System Definition
3D Sketch AI is a browser-based, open-source 3D modeling system with SketchUp-like direct manipulation.

Required stack from project start:
- Three.js (rendering and interaction)
- Replicad (modeling API layer)
- OpenCascade WASM (exact geometry kernel)

Core rule:
- Users manipulate geometry directly.
- The system generates executable TypeScript modeling code for every modeling action.

## 2. Source of Truth Separation

### 2.1 Application Development System
Scope: architecture and behavior of the 3D Sketch AI application.

Source of truth: `INTENT.md`.

This document is authoritative for:
- architecture
- interaction behavior
- performance requirements
- product boundaries

### 2.2 Modeling System (User Geometry)
Scope: user model state and regeneration.

Source of truth in V1: executable TypeScript modeling code.

The code:
- is generated from interaction
- fully represents committed operations
- executes through Replicad + OpenCascade

V1 boundary:
- no direct user editing of generated modeling code
- no direct user-facing constraints or parametric relationship authoring

## 3. Canonical Model Rule
The canonical model is executable TypeScript. No custom modeling file format is canonical.

Canonical requirements:
- deterministic regeneration
- complete representation of committed operations
- single authoritative scene definition

UI requirement:
- interaction updates must eventually serialize to canonical modeling code

## 4. Interaction Philosophy
The UI is non-parametric-first.

Users are not required to:
- create sketches
- define constraints
- manage feature trees
- reason about history graphs

Internal parametric structure MUST exist, but it is not exposed in V1 UI.

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
- save and load scene state as executable TypeScript model code

## 6. Interaction Execution Model
All manipulations use two phases:
1. Interactive Preview Phase
2. Commit Phase

### 6.1 Interactive Preview Phase
During active input:
- do not execute full model code on each event
- do not invoke the CAD kernel on each event
- maintain a transient operation and continuously update its parameters
- update preview mesh at interactive frame rates

Preview constraints:
- close approximation of commit result
- same semantic parameters as commit operation
- transient and non-authoritative

### 6.2 Commit Phase
On interaction completion:
- generate committed TypeScript operation
- append operation to canonical model code
- execute model via Replicad + OpenCascade
- replace preview with exact resulting geometry

Commit outcome:
- exact geometry becomes visible
- canonical authority remains committed code

### 6.3 Consistency Constraint
Preview and commit must be driven by the same operation parameters to avoid visible discontinuity at commit.

## 7. Representation Model
The runtime maintains:
- display mesh representation for interaction and rendering
- exact kernel geometry for correctness

Rules:
- during interaction, display mesh is preview-driven
- after commit, display mesh is regenerated from exact geometry
- canonical source of truth is committed modeling code only

## 8. Layered Architecture

### 8.1 View Layer
- Three.js scene graph
- camera and viewport control
- overlays and visual feedback

### 8.2 Interaction Layer
- selection pipeline
- manipulation tool state machines
- minimal snapping and inference for V1

### 8.3 Operation Layer
- interaction-to-operation mapping
- operation parameter validation
- serialization to executable TypeScript

### 8.4 Modeling Layer
- Replicad execution interface
- OpenCascade exact geometry execution

### 8.5 Representation Layer
- display mesh lifecycle management
- exact geometry lifecycle management
- preview/commit synchronization

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
- structured introspection over generated modeling code
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
- modeling code that maps clearly to user actions

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
