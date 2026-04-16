# 3D Sketch AI

3D Sketch AI is a browser-based 3D sketching prototype focused on SketchUp-style direct manipulation with a canonical, executable model script as the source of truth for the model.

## Current Focus

- SketchUp-like camera navigation and direct object/face manipulation
- Face selection, preselection highlighting, push/pull, move, rotate, scale, grouping, and components
- Persisted model script, camera state, tool state, selection mode, and app settings
- Model-only undo/redo through model script snapshots
- Ground themes and terrain variation for scene context
- Direct Replicad-compatible modeling calls, with 3DSAI helper functions kept outside the user's model script

## Canonical Model Script

The user's model script must remain executable TypeScript made of real callable modeling code. The app must not encode behavior in comments, parse comments into modeling actions, or introduce a custom hidden modeling language.

If a modeling pattern is not directly exposed by Replicad, the callable helper belongs in the 3DSAI modeling library, and the user script should call that helper directly.

## Navigation Controls

### Desktop

| Action | Input |
|--------|-------|
| Pan | Left-click drag |
| Orbit | Right-click drag |
| Zoom | Scroll wheel |
| Switch orbit ↔ pan | Shift + right-click drag |

### Mobile (multi-touch)

| Action | Gesture |
|--------|---------|
| Zoom in / out | Two-finger pinch (spread or close) |
| Orbit around the scene | Two-finger drag (move both fingers together) |

Both zoom and orbit can be applied simultaneously during a two-finger gesture. Single-touch events continue to work normally for selection and single-finger navigation.

## Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

- `src/app/` - application orchestration and runtime control
- `src/interaction/` - tool and selection interaction state (including `touch-gesture-handler.js` for mobile multi-touch)
- `src/modeling/` - canonical model execution and 3DSAI modeling helpers
- `src/operation/` - operation mapping, validation, and serialization
- `src/representation/` - Three.js scene representation of model state
- `src/view/` - viewport, camera, rendering, and overlay UI
- `src/environment/` - ground themes and terrain generation
- `src/persistence/` - local app/session/model history persistence
- `test/` - Node test suite

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
