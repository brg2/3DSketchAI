/**
 * TouchGestureHandler — multi-touch zoom and orbit for mobile devices.
 *
 * Attach to the canvas element. When two or more fingers are active:
 *   - Pinch (fingers spreading/closing) → zoom in/out.
 *   - Two-finger drag (midpoint translation) → orbit around the scene.
 *
 * Single-touch events are left unintercepted so the existing pointer-event
 * handlers continue to manage selection and single-finger pan/navigation.
 */
export class TouchGestureHandler {
  constructor({ viewport }) {
    this.viewport = viewport;
    this._gestureActive = false;
    this._lastPinchDistance = null;
    this._lastMidpointX = null;
    this._lastMidpointY = null;
    this._element = null;

    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
  }

  attach(element) {
    this._element = element;
    element.addEventListener("touchstart", this._onTouchStart, { passive: false });
    element.addEventListener("touchmove", this._onTouchMove, { passive: false });
    element.addEventListener("touchend", this._onTouchEnd, { passive: false });
    element.addEventListener("touchcancel", this._onTouchEnd, { passive: false });
  }

  detach() {
    if (!this._element) {
      return;
    }
    this._element.removeEventListener("touchstart", this._onTouchStart);
    this._element.removeEventListener("touchmove", this._onTouchMove);
    this._element.removeEventListener("touchend", this._onTouchEnd);
    this._element.removeEventListener("touchcancel", this._onTouchEnd);
    this._element = null;
    this._endGesture();
  }

  _touchDistance(t0, t1) {
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _touchMidpoint(t0, t1) {
    return {
      clientX: (t0.clientX + t1.clientX) * 0.5,
      clientY: (t0.clientY + t1.clientY) * 0.5,
    };
  }

  _onTouchStart(event) {
    if (event.touches.length < 2) {
      return;
    }

    event.preventDefault();

    const t0 = event.touches[0];
    const t1 = event.touches[1];
    const mid = this._touchMidpoint(t0, t1);

    this._lastPinchDistance = this._touchDistance(t0, t1);
    this._lastMidpointX = mid.clientX;
    this._lastMidpointY = mid.clientY;

    if (!this._gestureActive) {
      this._gestureActive = true;
      this.viewport.beginTouchGesture();
    }
  }

  _onTouchMove(event) {
    if (event.touches.length < 2 || !this._gestureActive) {
      return;
    }

    event.preventDefault();

    const t0 = event.touches[0];
    const t1 = event.touches[1];
    const newDistance = this._touchDistance(t0, t1);
    const mid = this._touchMidpoint(t0, t1);

    if (this._lastPinchDistance !== null && this._lastPinchDistance > 0 && newDistance > 0) {
      const scale = newDistance / this._lastPinchDistance;
      this.viewport.applyTouchPinchScale({ scale, clientX: mid.clientX, clientY: mid.clientY });
    }

    if (this._lastMidpointX !== null && this._lastMidpointY !== null) {
      const dx = mid.clientX - this._lastMidpointX;
      const dy = mid.clientY - this._lastMidpointY;
      this.viewport.applyTouchOrbitDelta({ dx, dy });
    }

    this._lastPinchDistance = newDistance;
    this._lastMidpointX = mid.clientX;
    this._lastMidpointY = mid.clientY;
  }

  _onTouchEnd(event) {
    if (event.touches.length < 2 && this._gestureActive) {
      this._endGesture();
    }
  }

  _endGesture() {
    if (!this._gestureActive) {
      return;
    }
    this._gestureActive = false;
    this._lastPinchDistance = null;
    this._lastMidpointX = null;
    this._lastMidpointY = null;
    this.viewport.endTouchGesture();
  }
}
