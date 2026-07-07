import type { Point, Size } from './geometry.js';

export type PlotInputEventType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'pointercancel'
  | 'wheel'
  | 'keydown'
  | 'keyup'
  | 'focus'
  | 'blur'
  | 'resize'
  | 'contextmenu';

export interface InputModifiers {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface NormalizedInputBase {
  defaultPrevented: boolean;
  modifiers: InputModifiers;
  originalEvent: Event;
  timeStamp: number;
  type: PlotInputEventType;
}

export interface NormalizedPointerEvent extends NormalizedInputBase {
  button: number;
  buttons: number;
  client: Point;
  host: Point;
  pointerId: number;
  pointerType: string;
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';
}

export interface NormalizedWheelEvent extends NormalizedInputBase {
  client: Point;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  host: Point;
  type: 'wheel';
}

export interface NormalizedKeyEvent extends NormalizedInputBase {
  code: string;
  key: string;
  repeat: boolean;
  type: 'keydown' | 'keyup';
}

export interface NormalizedFocusEvent extends NormalizedInputBase {
  relatedTarget: EventTarget | null;
  type: 'focus' | 'blur';
}

export interface NormalizedResizeEvent {
  cssSize: Size;
  devicePixelRatio: number;
  pixelSize: Size;
  type: 'resize';
}

export interface NormalizedContextMenuEvent extends NormalizedInputBase {
  client: Point;
  host: Point;
  type: 'contextmenu';
}

export interface PlotInputEvents {
  pointer: NormalizedPointerEvent;
  wheel: NormalizedWheelEvent;
  key: NormalizedKeyEvent;
  focus: NormalizedFocusEvent;
  blur: NormalizedFocusEvent;
  resize: NormalizedResizeEvent;
  contextmenu: NormalizedContextMenuEvent;
}
