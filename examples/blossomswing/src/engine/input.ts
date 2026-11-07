// Minimal input: held keys + pointer drag. Game code maps these to high-level actions,
// and the SAME actions are what __game.input() accepts — so tests exercise real game logic.
// Interpret a drag in a reference frame captured on 'dragstart' (e.g. the camera yaw), never the live
// camera: if the camera reacts to the drag, a live frame becomes a feedback loop and the view spins.

export interface DragStart {
  x: number;
  y: number;
}
export interface DragEnd {
  dx: number;
  dy: number;
  cancelled?: true;
}
interface InputEvents {
  dragstart: DragStart;
  dragend: DragEnd;
}

export interface Input {
  keys: Set<string>;
  drag: { active: boolean; startX: number; startY: number; x: number; y: number };
  down(code: string): boolean;
  on<K extends keyof InputEvents>(evt: K, fn: (e: InputEvents[K]) => void): void;
}

export function createInput(canvas: HTMLElement): Input {
  const keys = new Set<string>();
  const drag = { active: false, startX: 0, startY: 0, x: 0, y: 0 };
  const listeners: { [K in keyof InputEvents]: ((e: InputEvents[K]) => void)[] } = { dragstart: [], dragend: [] };
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    Object.assign(drag, { active: true, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY });
    for (const fn of listeners.dragstart) fn({ x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag.active) Object.assign(drag, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag.active) return;
    drag.active = false;
    for (const fn of listeners.dragend) fn({ dx: drag.x - drag.startX, dy: drag.y - drag.startY });
  });
  // OS gesture / lost capture: end the drag as a zero-length (cancelled) one so it never sticks
  canvas.addEventListener('pointercancel', () => {
    if (!drag.active) return;
    drag.active = false;
    for (const fn of listeners.dragend) fn({ dx: 0, dy: 0, cancelled: true });
  });
  return {
    keys,
    drag,
    down: (code) => keys.has(code),
    on: (evt, fn) => void listeners[evt].push(fn),
  };
}
