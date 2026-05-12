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

## 3.3 Parameter Model
Parameters are first-class feature-graph data.

The system MUST support:
- named parameters for feature dimensions and modeling intent
- parameter creation from user input and AI-assisted changes
- parameter references inside feature definitions
- parameter updates that preserve deterministic replay
- parameter insertion, renaming, deletion, and value editing through controlled UI
- parameter binding to literal values or parameter names inside feature definitions

Parameters:
- belong to the feature graph
- are not a separate modeling system
- may be surfaced in the UI only through controlled editing interfaces
- must remain reproducible from the feature graph and its history

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
After a split, face identity MUST be preserved or remapped so selectors and downstream operations reference the correct sub-face region.

## 4.1.9 Sketch-Aware Face Splitting
When a user draws additional subdivision lines on a face that originated from an existing sketch-driven split operation, the system MUST attempt to modify the upstream sketch instead of creating a new split feature or performing incremental topology surgery.

The split feature MUST then recompute from the updated sketch as a single coherent subdivision operation.

Rules:
- sketches are authoritative subdivision definitions
- resulting faces MUST remain traceable to the originating split feature and sketch
- the system MUST use sketch provenance to preserve stable interaction semantics
- the system MUST not create overlay geometry, offset fans, or viewer-side fake splits
- the system MUST not incrementally mutate already-mutated topology when sketch continuation semantics apply
- the system MUST not modify mesh geometry directly

The system MUST maintain provenance relationships:
- resulting face -> originating split feature -> originating sketch

## 4.1.10 Prohibited Behavior
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

## 4.6 AI Prompt Interface
The system MUST provide a prompt-based AI editing interface adjacent to the feature graph.

The interface MUST:
- present a simple prompt text box for AI-assisted feature-graph changes
- accept a user prompt plus the current selection as context
- treat the current selection and its provenance as pre-context
- include the current feature graph schema in the prompt context
- include the current feature graph snapshot in the prompt context
- include a current-view snapshot in the prompt context
- include feature provenance needed to identify the intended edit target
- support suggested changes such as resizing primitives or modifying feature parameters

Context assembly MUST include:
- feature graph schema
- current feature graph snapshot
- current selection
- selection provenance
- current view snapshot
- user prompt text

The AI output MUST:
- describe changes to the current feature graph only
- return a patch or diff against the current feature graph rather than a full replacement when possible
- remain machine-applicable and deterministic
- not directly mutate meshes or viewer geometry
- not bypass the feature graph

AI prompt behavior MUST be feature-graph aware and selection-aware.
AI suggestions MUST be applied only through validated feature-graph edits.

AI provider support MUST include:
- OpenAI
- Claude
- Gemini
- Grok

API key handling requirements:
- provider API keys MUST be stored locally in an encrypted, origin-scoped vault
- keys MUST NOT be sent to a backend proxy
- the system SHOULD use platform-backed secure storage when available
- the system MUST provide a local encrypted fallback when platform storage is unavailable
- keys are user-controlled and may be removed at any time

Security boundary:
- the system cannot guarantee that a compromised local device is unobservable
- the system MUST minimize key exposure and keep keys outside remote application state
- no provider key may be exposed in the feature graph, prompt history, or exported model data

## 4.7 Parameter Editor
The system MUST provide a controlled parameter editing UI for feature-graph parameters.

The parameter editor:
- is separate from raw feature-graph editing
- is an interactive JSON-tree-style view of editable parameter data, not an editable feature-graph editor
- is colocated with the feature graph view and rendered below the feature graph title
- appears above the feature graph display area inside the feature graph group or component
- supports editing parameter names, numeric values, and parameter references
- supports adding and removing parameters
- updates the rendered feature graph immediately when a parameter changes

Parameter editor layout:
- add-parameter control near the feature-graph controls such as compress and copy
- parameter name field on the left
- delete control on the far side of the parameter row
- slider with full-width allocation for the remaining row space
- manual numeric input field adjacent to the slider with minimal width

Parameter behavior:
- parameter sliders MUST update the feature graph preview and commit pipeline instantly
- changing a parameter MUST redraw affected geometry through the feature graph, not by direct graph mutation
- a parameter may be assigned a literal value or referenced by name inside the feature graph
- parameter deletion MUST warn when the parameter is in use
- when deletion is confirmed for an in-use parameter, references MUST be replaced with the parameter's current value at the time of deletion
- the editor MUST preserve deterministic replay after any parameter change
- the editor MUST keep selection and provenance intact while parameter-driven redraw is in progress

Default numeric range:
- default minimum is `-100`
- default maximum is `+100`
- default initial value is `0`
- range tuning MAY be exposed in settings if needed

The parameter editor MUST NOT:
- expose raw feature-graph structure editing
- allow users to directly edit feature graph topology or dependencies
- bypass validation when adding, renaming, deleting, or rebinding parameters

Parameter editing MUST remain feature-graph-backed and read from the current model state.
The feature graph remains read-only in this UI.

## 5. Tooling Scope (V1)
Required tools:
- selection (face, edge, object)
- push/pull
- move
- rotate
- scale
- primitive creation
- line draw
- grouping and components

### 5.1 Line Draw Tool
The line draw tool is a V1 topology-editing tool.

It is used to place ordered points in feature/model space and commit them as a sketch-aware face-splitting BREP operation when applied on an existing face.

Usage:
- select or infer a drawing plane
- click to place vertices
- drag to preview the next segment
- double-click or close the loop to commit the polyline

Modeling rules:
- point order is preserved
- the committed result is deterministic and replayable
- the tool stores subdivision intent as a sketch graph associated with the target face
- the sketch graph is authoritative for subdivision intent
- the BREP split feature is the generated result of the sketch graph
- when committed on a face, the sketch MUST produce a real BREP topology change
- the committed result MUST replace the original face topology with newly created faces
- the resulting sub-faces MUST be first-class selectable faces
- the resulting sub-faces MUST support downstream direct modeling operations such as push/pull and face-level move/rotate when applicable
- the original face is no longer treated as a single continuous surface after commit
- the line itself is not the source of truth; the resulting BREP topology is the source of truth
- split results MUST be represented in the feature graph and replayed deterministically
- subsequent subdivision lines on a derived face MUST attempt to modify the originating sketch first
- the system MUST prefer re-entering the upstream sketch over creating a new split feature when sketch continuation semantics apply
- incremental topology surgery on already-mutated faces is disallowed when sketch continuation semantics apply

Face sketch execution pipeline:
1. take sketch
   - capture user-drawn curves in sketch space
   - ensure curves are well-defined and valid for splitting
2. project onto face
   - map 2D sketch curves onto the target face surface
   - produce valid 3D curves lying on the surface
3. split face in BREP
   - use projected curves to split the target face
   - perform a full topological update with edges, wires, and faces
   - do not use mesh or overlay approximations
4. replace original face(s)
   - remove the original face from the solid
   - insert newly created faces into the topology
   - maintain a valid watertight solid
5. regenerate mesh
   - tessellate the updated BREP
   - update render geometry accordingly
   - mesh must reflect true topology

Independent extrusion rule:
- resulting sub-faces MUST be independently extrudable via push/pull
- repeated direct modeling on a split region must target the split face region, not the pre-split aggregate face

Scope:
- V1 uses simple polygonal/polyline drawing, not NURBS-based drawing
- NURBS-based line drawing is out of scope for V1 and may be considered later only as an extension of the feature graph

### 5.2 Line Draw Snapping and Inference
Snapping is always on by default.

Required snap targets:
- vertex snapping at edge endpoints
- edge snapping at midpoints and along-edge inference
- face plane inference for coplanar drawing

Inference rules:
- cursor movement should lock onto existing vertices, edge midpoints, and edge directions when relevant
- snapping must be visually indicated
- snapping must reduce ambiguity without requiring numeric input
- optional modifier keys may refine behavior later, but base behavior must work without them
- priority order is vertex, then edge, then face plane

Snapping must operate in feature/model space and remain stable under replay.

Preview vs commit behavior:
- preview MAY display temporary projected curves and potential split regions
- preview MAY show lightweight visual hints
- preview MAY evaluate the active sketch against the cached base BRep for interactive feedback
- preview MUST NOT create overlay geometry as a final state
- commit MUST execute the full BREP split pipeline
- commit MUST recompute the full split feature from the updated sketch graph
- commit MUST replace topology authoritatively

### 5.3 System-Level Implications
Face identity must persist or be remapped after splits so that:
- feature graph updates correctly
- subsequent operations reference the correct topology

The modeling kernel MUST treat the split as a real BREP operation, not a visual subdivision.

The Three.js layer MUST:
- reflect updated topology immediately
- maintain correct selection mapping between rendered mesh and kernel faces

Sketch ownership rules:
- sketches are topology planning environments and upstream subdivision intent definitions
- sketches are not disposable drawing artifacts
- the system MUST trace resulting faces back to the originating split feature and originating sketch
- the system MUST use that provenance to decide whether new lines modify the sketch or create a new split feature

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
- evaluate the active sketch against the cached base BRep for interactive feedback
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
- if the committed operation is a sketch-on-face edit, recompute the upstream sketch and run the full BREP split pipeline from that sketch
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
- minimal snapping and inference for V1, including line-draw snapping
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

### 8.7 AI Editing Layer
- prompt text box for AI-assisted feature-graph edits
- local prompt assembly from schema, snapshot, selection, provenance, and user prompt
- provider abstraction for OpenAI, Claude, Gemini, and Grok
- local encrypted API-key vault
- patch/diff application against the feature graph
- validated feature-graph mutation only

Rules:
- AI outputs MUST be applied as feature-graph patches or equivalent machine-applicable diffs
- AI outputs MUST NOT mutate meshes directly
- AI outputs MUST NOT bypass the feature graph
- AI outputs MUST NOT require a backend proxy
- AI key usage MUST remain origin-scoped and local to the app

## 9. Testing and Behavioral Consistency (Non-Optional)
The system MUST implement deterministic, automated, end-to-end testing for all user-facing modeling tools using Playwright.

No feature or tool modification is complete without corresponding test coverage.

### 9.1 Core Requirement
All tool behavior MUST be validated through:
1. UI-driven interaction (Playwright)
2. scene-level assertions (Three.js state)
3. visual regression (pixel comparison)
4. geometry-level validation (topology/mesh invariants where possible)

Testing objective:
- detect silent behavioral regressions
- enforce stable tool behavior across code changes

### 9.2 Coverage Matrix Requirements
For every tool, tests MUST cover:
- each selection type supported by the tool (object, face, edge, vertex when supported)
- each interaction mode (single action, drag interaction, modifier input, repeated invocation)
- each tool state (new invocation/feature creation, existing-feature modification when applicable)

This matrix MUST be explicitly defined and generated.
Manual testing is not acceptable as primary coverage.

### 9.3 Required Test Infrastructure
The system MUST provide:
- Playwright E2E harness that launches the full app and executes interactions through public UI only
- scene inspection hooks via a test-only API for deterministic assertions
- visual regression pipeline with baseline images and pixel-diff thresholding
- geometry/topology assertion utilities where possible

Required test-only API capabilities include:
- scene graph snapshot
- mesh/geometry summary
- selected entity state
- transform state
- tool state

Example shape:
- `window.__TEST_API__.getSceneState()`

### 9.4 Geometry and Invariant Assertions
Tests SHOULD validate, where applicable:
- vertex counts
- face counts
- bounding boxes
- expected transforms
- semantic invariants (for example, extrusion increases volume)

These checks prevent visually plausible but incorrect geometry outcomes.

### 9.5 Test Generation Strategy (Mandatory)
Agents MUST NOT hand-write the full combination space manually.

A structured matrix MUST drive generated Playwright tests:
- tools x selection types x interaction modes x modifier states x invocation state

Each generated case MUST define:
- deterministic initial scene setup
- exact interaction sequence
- expected scene-state assertions
- expected visual snapshot assertions

### 9.6 Baselines and Failure Policy
Baselines (scene-state and visual snapshots) MUST be versioned.
Baselines may be updated only for intentional behavior changes.

Any failing test is blocking and indicates:
- tool behavior regression
- cross-tool side effects
- rendering or interaction inconsistency

No feature work may be considered complete while required tests are failing.

### 9.7 Prohibited Testing Anti-Patterns
The following are explicitly disallowed:
- relying on manual QA as tool-validation coverage
- testing only happy paths
- skipping modifier or repeated-use scenarios
- omitting visual regression validation
- omitting geometry/state validation

### 9.8 Architectural Testing Contract
The system MUST preserve this pipeline:
- intent -> tool -> interaction -> deterministic outcome

Testing is the enforcement layer for this contract and is the safety boundary for AI-driven code changes.

### 9.9 Feature Graph Consistency and Evolution (Non-Optional)
The system MUST guarantee that modeling operations produce a correct, minimal, and stable feature graph.

The feature graph represents modeling intent and MUST NOT degrade over repeated tool usage.

Core behavioral requirement for operation sequences (`tool A -> tool B -> tool C`):
1. correctly update the feature graph
2. reuse or modify existing features when appropriate
3. avoid redundant or duplicate feature creation
4. preserve intent relationships and dependencies between features

#### 9.9.1 Mandatory E2E Coverage
Playwright E2E tests MUST validate feature graph behavior across sequential tool usage.

This is required in addition to scene/geometry/visual validation.

Test workflows MUST:
1. start from deterministic base geometry
2. apply first operation
3. apply second operation (different tool or variation)
4. optionally apply a third operation
5. after each step, assert:
- feature graph state
- geometry state
- no unintended feature duplication

#### 9.9.2 Tool Combination Matrix
Agents MUST programmatically generate workflow tests across:
- tools: `move`, `rotate`, `push/pull`, `line draw`
- selection types: `object`, `face`
- sequence lengths: 2-step (`A -> B`) and 3-step (`A -> B -> C`)

Example combinations include:
- `move(object) -> rotate(object)`
- `push/pull(face) -> move(face)`
- `move(object) -> push/pull(face)`
- `rotate(face) -> move(object)`
- `line draw(face) -> push/pull(face)`
- `line draw(face) -> line draw(face)`

Manual hand-writing of the full combination space is disallowed.

#### 9.9.3 Required Feature Graph API and Snapshot Shape
The app MUST expose a test-only API:
- `window.__TEST_API__.getFeatureGraph()`

The returned graph MUST include:
- feature list
- feature types
- feature dependencies
- feature targets (object/face references)

Feature graph snapshot testing is mandatory after each operation step.
Snapshots MUST include:
- feature id
- feature type
- parent/child relationships

#### 9.9.4 Required Assertions Per Step
Tests MUST assert all of the following after each operation:

1. Feature count correctness
- feature count increases only when required
- compatible repeated operations SHOULD modify existing features rather than create duplicates

2. Feature type correctness
- `move` creates/updates transform feature behavior
- `rotate` creates/updates transform feature behavior
- `push/pull` creates/updates geometry-modifying feature behavior
- `line draw` creates/updates polyline feature behavior

3. Feature target stability
- feature targets remain correctly attached to intended object/face
- no orphaned or broken references are allowed

3a. Line draw face splitting
- when line draw is committed on a face, the face MUST split into the expected regions
- split faces MUST remain traceable through feature-origin identity
- split faces MUST remain independently selectable and independently extrudable
- face split results MUST be validated in both geometry state and feature graph snapshots
- additional line draws on an already split face MUST modify the originating sketch when sketch continuation semantics apply
- tests MUST fail if a new split feature is created instead of re-entering the upstream sketch under sketch continuation semantics
- tests MUST fail if the implementation produces overlay geometry, offset fans, or viewer-side fake splits
- committed sketch-on-face results MUST have no residual overlay geometry
- committed sketch-on-face results MUST be verified as real BREP topology changes

4. Modification over creation when intent continues
- prefer modification over creation when tool, selection target, and intent continuation are the same
- tests MUST explicitly validate this preference path

5. No redundant feature stacking
- no identical move feature stacking on the same target when update is sufficient
- no repeated push/pull stacking on the same face without explicit need
- no transform stacking when a single transform feature should be updated

#### 9.9.5 Sequence Validation Examples (Required)
Required baseline example:
1. `move(object: cube)`
2. `move(object: cube)`

Assertion:
- feature count is `1` if modification semantics are defined for this case
- feature count may be `2` only when explicitly defined by intent and asserted by tests

Required complex example:
1. `push/pull(face: top)`
2. `move(object: cube)`
3. `push/pull(face: top again)`

Assertions:
- second push/pull references updated geometry correctly
- dependency chain remains valid
- no broken references
- no unnecessary duplicate features

#### 9.9.6 Failure Conditions and Forbidden Anti-Patterns
Tests MUST fail when:
- feature graph grows unnecessarily
- features are duplicated incorrectly
- references break
- wrong feature is modified
- dependency chain is invalid

The following are explicitly forbidden:
- always creating new features instead of modifying existing ones
- losing reference to original faces after modification
- rebuilding geometry without updating the feature graph
- treating the feature graph as secondary to geometry

#### 9.9.7 Architectural Requirement
The system MUST behave as:
- intent -> feature graph -> geometry

The following model is invalid:
- geometry -> guessed feature graph

Feature graph remains the source of truth.

Long-term requirements for the feature graph:
- minimal (no unnecessary redundancy)
- stable (predictable updates)
- editable (supports safe modification)
- testable (fully asserted through E2E workflows)

## 9.10 AI Editing Validation (Non-Optional)
The AI editing interface MUST be tested as part of the application contract.

Tests MUST validate:
- prompt assembly includes feature graph schema, current feature graph snapshot, current selection, provenance, current view snapshot, and user prompt
- AI output is a patch or diff against the current feature graph, not a mesh edit
- AI output mutates the feature graph only through validated edits
- AI editing works without a backend proxy
- provider configuration does not leak API keys into feature graph data or exported model data
- provider switches remain local and deterministic

Tests SHOULD validate:
- parameter creation and parameter updates through AI-assisted edits
- selection-aware edits target the intended face or object
- provenance-aware edits preserve downstream correctness

## 9.11 Parameter Editing Validation (Non-Optional)
The parameter editor MUST be covered by automated E2E tests.

Tests MUST validate:
- parameter creation from the UI add control
- parameter renaming in the parameter list
- slider movement updates the live feature graph preview immediately
- numeric input and slider stay synchronized
- parameter deletion warning when the parameter is in use
- confirmation behavior when deleting an in-use parameter
- replacement of in-use references with the parameter's current value on confirmed deletion
- redraw behavior after parameter changes remains deterministic
- the feature graph itself remains read-only in the UI

Tests SHOULD validate:
- parameter values default to the expected range and center value
- parameter edits preserve provenance and selection context
- parameter-driven redraws preserve selection visibility and hit testing

## 10. Performance Requirements
System requirements:
- interaction remains responsive during normal editing load
- preview updates run at interactive frame rates
- kernel execution never occurs on every pointer event
- heavy modeling computation does not block UI interaction

Execution policy:
- keep interaction loop lightweight
- defer/batch expensive recomputes
- run exact geometry recompute asynchronously from input handling

## 11. Open Source and Licensing
Project license: Apache License 2.0.

Repository requirements:
- `LICENSE` with Apache-2.0 text
- `NOTICE` when required
- explicit third-party attribution and license compatibility records

Contribution rule:
- all contributions and dependencies must be Apache-2.0-compatible for redistribution

## 12. Non-Goals (V1)
- parametric-first CAD workflow
- enterprise CAD feature completeness
- mesh sculpting workflow
- AI-first automatic modeling workflow
- proprietary product cloning

## 13. Exclusions (V1)
- feature tree UI
- parametric editing UI
- advanced snapping/inference systems
- AI-driven automatic geometry modifications

## 14. Long-Term Direction
Possible future evolution:
- structured introspection over feature graph operations
- optional parametric editing interfaces above the same model core
- AI-assisted modeling workflows with explicit user control
- live recompute architecture with partial model reevaluation

Not a V1 commitment.

## 15. Design Principles
All architecture and product decisions prioritize:
- interaction first
- minimal latency
- predictable behavior
- direct manipulation over abstraction
- internal feature determinism with simple user-facing interaction

## 16. Intent Governance
`INTENT.md` is the authoritative definition of system intent.

When intent changes, development workflow must:
1. detect semantic deltas
2. derive scoped engineering tasks
3. apply changes in small, targeted updates
4. verify alignment after each update

Change discipline:
- no large destructive rewrites to satisfy intent updates
- preserve clarity, determinism, and architectural separation
