import {
  addEventListenerDisposable,
  createDomInputAdapter,
  createLatestRafScheduler,
  normalizeBrushNumericRange,
  normalizePointerEvent,
  snapshotBrushModifiers,
  toDisposable,
  type Disposable,
  type DomInputAdapter,
  type InputModifiers,
  type NormalizedKeyEvent,
  type NormalizedPointerEvent,
} from '../../plot-engine/core/index.js';
import {
  findNearestParallelRecordByIndexedPoint,
  findNearestParallelRecordByPoint,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  parallelDisplayValueToRenderedNormalizedValue,
  type NumericRange,
  type ParallelBrushIntervals,
  type ParallelHoverIndex,
  type ParallelParameter,
} from '../core/index.js';
import type { ParallelFastBinding, ParallelFastPlotInstance } from './types.js';
import type {
  ParallelFastBrushChangeReason,
  ParallelFastBrushDefaultAction,
  ParallelFastBrushEvent,
} from './parallelEvents.js';

export type ParallelFastBrushDragKind = 'create' | 'max' | 'min' | 'move';

export interface ParallelFastAxisBounds {
  height: number;
  top: number;
}

export interface ParallelFastBrushHit {
  axis: ParallelParameter;
  axisBounds: ParallelFastAxisBounds;
  axisRangeIndex?: number;
  kind: ParallelFastBrushDragKind;
}

export type ParallelFastBrushHitTest = (
  event: NormalizedPointerEvent,
  plot: ParallelFastPlotInstance,
) => ParallelFastBrushHit | null;

export interface ParallelFastInspectionOptions {
  explicitHoverModeActive?: () => boolean;
  getHoverIndex?: () => ParallelHoverIndex | null;
  maxDistancePx?: number;
  smallDatasetFallbackRecordLimit?: number;
}

export interface DefaultParallelBindingsOptions {
  /**
   * @deprecated Use brushHitTest. This alias is kept for one compatibility cycle.
   */
  axisHitTest?: ParallelFastBrushHitTest | null;
  brushHitTest?: ParallelFastBrushHitTest | null;
  axisBrushGestures?: readonly ParallelFastAxisBrushGesture[];
  coordinateTarget?: HTMLElement;
  ignoreKeyboardTarget?: (target: EventTarget | null) => boolean;
  inputAdapter?: DomInputAdapter;
  inputElement?: HTMLElement;
  inspection?: ParallelFastInspectionOptions;
  keyboardTarget?: EventTarget;
  shortcutGate?: () => boolean;
}

export interface ParallelFastAxisBrushGesture {
  button: 0 | 2;
  defaultAction: Extract<ParallelFastBrushDefaultAction, 'none'>;
  modifiers?: Partial<InputModifiers>;
}

interface ParallelFastBrushDragState {
  axis: ParallelParameter;
  axisBounds: ParallelFastAxisBounds;
  axisRangeIndex: number;
  currentRange: NumericRange;
  defaultAction: ParallelFastBrushDefaultAction;
  domain: { max: number; min: number; span: number };
  kind: ParallelFastBrushDragKind;
  modifiers: NormalizedPointerEvent['modifiers'];
  originalRange: NumericRange | null;
  pointerId: number;
  startRawValue: number;
}

interface PendingParallelBrushUpdate {
  axis: ParallelParameter;
  axisRangeIndex: number;
  modifiers: NormalizedPointerEvent['modifiers'];
  range: NumericRange;
  reason: ParallelFastBrushChangeReason;
}

interface ParallelFastBrushClickState {
  axis: ParallelParameter;
  axisRangeIndex: number;
  timeStamp: number;
}

interface ParallelFastViewportDragState {
  axisIndex: number;
  currentY: number;
  kind: 'pan' | 'zoom';
  pointerId: number;
  startViewports: import('../core/index.js').ParallelAxisViewports;
  startY: number;
}

const DOUBLE_CLICK_MAX_DELAY_MS = 500;
const VIEWPORT_DRAG_MIN_CSS_PX = 4;

export function createDefaultParallelBindings(
  options: DefaultParallelBindingsOptions = {},
): ParallelFastBinding {
  return (plot) => {
    const disposables: Disposable[] = [];
    const inputElement = options.inputElement ?? plot.commands.getHostElement();
    const coordinateTarget = options.coordinateTarget ?? plot.commands.getHostElement();
    const brushHitTest = options.brushHitTest ?? options.axisHitTest ?? null;
    const inputAdapter =
      options.inputAdapter ??
      createDomInputAdapter(inputElement, {
        coordinateTarget,
      });
    if (!options.inputAdapter) {
      disposables.push(inputAdapter);
    }

    let dragState: ParallelFastBrushDragState | null = null;
    let viewportDragState: ParallelFastViewportDragState | null = null;
    let currentBrushIntervals = plot.commands.getStateSnapshot().brush.brushIntervals;
    let latestBrushUpdate: PendingParallelBrushUpdate | null = null;
    let latestInspectionActive = plot.commands.getStateSnapshot().inspection !== null;
    let inspectionRequestSequence = 0;
    let lastBrushClick: ParallelFastBrushClickState | null = null;
    const viewportOverlay = coordinateTarget.ownerDocument.createElement('div');
    viewportOverlay.className = 'parallel-fast-axis-viewport-box';
    Object.assign(viewportOverlay.style, {
      background: 'rgba(15, 118, 110, 0.18)',
      border: '1px solid rgba(15, 118, 110, 0.72)',
      borderRadius: '4px',
      boxSizing: 'border-box',
      display: 'none',
      pointerEvents: 'none',
      position: 'absolute',
      transform: 'translateX(-50%)',
      width: '2.3rem',
      zIndex: '4',
    });
    viewportOverlay.setAttribute('aria-hidden', 'true');
    plot.commands.getHostElement().append(viewportOverlay);
    disposables.push(toDisposable(() => viewportOverlay.remove()));

    const applyBrushUpdate = (update: PendingParallelBrushUpdate) => {
      currentBrushIntervals = updateAxisBrushInterval(
        currentBrushIntervals,
        update.axis,
        update.axisRangeIndex,
        update.range,
      );
      plot.commands.previewBrushIntervals(currentBrushIntervals, {
        modifiers: update.modifiers,
        reason: update.reason,
        source: 'pointer',
      });
    };
    const flushLatestBrushUpdate = () => {
      const update = latestBrushUpdate;
      latestBrushUpdate = null;
      if (update !== null) {
        applyBrushUpdate(update);
      }
    };
    const pendingBrush = createLatestRafScheduler<PendingParallelBrushUpdate>(() => {
      flushLatestBrushUpdate();
    });
    const pendingInspection = createLatestRafScheduler<NormalizedPointerEvent>(
      (event) => {
        const requestSequence = ++inspectionRequestSequence;
        resolveInspection(
          plot,
          event,
          options.inspection,
          requestSequence,
          () => inspectionRequestSequence,
        );
        latestInspectionActive =
          plot.commands.getStateSnapshot().inspection !== null;
      },
    );
    const scheduleBrushDragMove = (event: NormalizedPointerEvent) => {
      if (dragState === null) {
        return;
      }
      event.originalEvent.preventDefault();
      const rawValue = rawValueFromClientY(
        event.client.y,
        dragState.axisBounds,
        dragState.domain,
      );
      dragState.modifiers = event.modifiers;
      const update = {
        axis: dragState.axis,
        axisRangeIndex: dragState.axisRangeIndex,
        modifiers: event.modifiers,
        range: createDraggedBrushRange(rawValue, dragState),
        reason: brushReasonForDragKind(dragState.kind),
      };
      dragState.currentRange = update.range;
      if (dragState.defaultAction === 'none') {
        emitTransientParallelBrushEvent(plot, dragState, 'preview', event);
        return;
      }
      latestBrushUpdate = update;
      pendingBrush.schedule(update);
    };
    const finishBrushDrag = (event?: NormalizedPointerEvent) => {
      if (dragState === null) {
        return;
      }
      if (dragState.defaultAction === 'none') {
        if (event !== undefined) {
          dragState.modifiers = event.modifiers;
        }
        emitTransientParallelBrushEvent(plot, dragState, 'commit', event);
        dragState = null;
        latestBrushUpdate = null;
        return;
      }
      if (latestBrushUpdate !== null) {
        pendingBrush.cancel();
        flushLatestBrushUpdate();
      }
      plot.commands.commitBrushIntervals(currentBrushIntervals, {
        modifiers: dragState.modifiers,
        reason: brushReasonForDragKind(dragState.kind),
        source: 'pointer',
      });
      dragState = null;
      latestBrushUpdate = null;
    };
    const moveViewportDrag = (event: NormalizedPointerEvent) => {
      if (
        viewportDragState === null ||
        event.pointerId !== viewportDragState.pointerId
      ) {
        return;
      }
      event.originalEvent.preventDefault();
      viewportDragState.currentY = event.host.y;
      updateViewportOverlay(plot, viewportOverlay, viewportDragState);
    };
    const finishViewportDrag = (event: NormalizedPointerEvent) => {
      if (
        viewportDragState === null ||
        event.pointerId !== viewportDragState.pointerId
      ) {
        return;
      }
      const completed = viewportDragState;
      viewportDragState = null;
      viewportOverlay.style.display = 'none';
      if (event.type === 'pointercancel') {
        return;
      }
      completed.currentY = event.host.y;
      const moved = Math.abs(completed.currentY - completed.startY);
      if (completed.kind === 'pan' && moved < VIEWPORT_DRAG_MIN_CSS_PX) {
        plot.commands.undoAxisViewport({ source: 'pointer' });
        return;
      }
      if (completed.kind === 'zoom' && moved < VIEWPORT_DRAG_MIN_CSS_PX) {
        return;
      }
      plot.commands.setAxisViewports(
        createDraggedAxisViewports(plot, completed),
        {
          phase: 'commit',
          reason: completed.kind,
          source: 'pointer',
        },
      );
    };
    disposables.push(pendingBrush, pendingInspection);
    disposables.push(
      toDisposable(inputAdapter.on('pointer', (event) => {
        if (event.type === 'pointerdown') {
          const hit = brushHitTest?.(event, plot) ?? null;
          const axisBrushGesture = resolveAxisBrushGesture(
            event,
            options.axisBrushGestures,
          );
          if (hit !== null && axisBrushGesture !== null) {
            event.originalEvent.preventDefault();
            const transientHit: ParallelFastBrushHit = {
              ...hit,
              axisRangeIndex: undefined,
              kind: 'create',
            };
            capturePointer(event.originalEvent, event.pointerId);
            startBrushDrag(
              plot,
              transientHit,
              event,
              axisBrushGesture.defaultAction,
              (nextDragState) => {
                dragState = nextDragState;
                emitTransientParallelBrushEvent(
                  plot,
                  nextDragState,
                  'preview',
                  event,
                );
              },
            );
            return;
          }
          if (event.button === 2 && hit !== null) {
            event.originalEvent.preventDefault();
            const isExistingBrushHit =
              hit.axisRangeIndex !== undefined && hit.axisRangeIndex >= 0;
            if (
              isExistingBrushHit &&
              lastBrushClick !== null &&
              lastBrushClick.axis === hit.axis &&
              lastBrushClick.axisRangeIndex === hit.axisRangeIndex &&
              event.timeStamp - lastBrushClick.timeStamp <= DOUBLE_CLICK_MAX_DELAY_MS
            ) {
              plot.commands.removeBrushInterval(hit.axis, hit.axisRangeIndex, {
                reason: 'remove',
                source: 'pointer',
              });
              lastBrushClick = null;
              return;
            }
            lastBrushClick = isExistingBrushHit
              ? {
                  axis: hit.axis,
                  axisRangeIndex: hit.axisRangeIndex ?? -1,
                  timeStamp: event.timeStamp,
                }
              : null;
            capturePointer(event.originalEvent, event.pointerId);
            currentBrushIntervals =
              hit.kind === 'create' && !event.modifiers.ctrlKey
                ? clearAxisBrushIntervals(
                    plot.commands.getStateSnapshot().brush.brushIntervals,
                    hit.axis,
                  )
                : plot.commands.getStateSnapshot().brush.brushIntervals;
            startBrushDrag(
              plot,
              hit,
              event,
              'select',
              (nextDragState, initialRange) => {
                dragState = nextDragState;
                currentBrushIntervals = updateAxisBrushInterval(
                  currentBrushIntervals,
                  nextDragState.axis,
                  nextDragState.axisRangeIndex,
                  initialRange,
                );
                plot.commands.previewBrushIntervals(currentBrushIntervals, {
                  modifiers: event.modifiers,
                  reason: brushReasonForDragKind(nextDragState.kind),
                  source: 'pointer',
                });
              },
            );
            return;
          }
          if (
            (event.button === 0 || event.button === 1) &&
            !isInteractivePointerTarget(event.originalEvent.target)
          ) {
            event.originalEvent.preventDefault();
            capturePointer(event.originalEvent, event.pointerId);
            const state = plot.commands.getStateSnapshot();
            const width = Math.max(
              1,
              plot.commands.getHostElement().getBoundingClientRect().width,
            );
            const axisIndex = closestParallelAxisIndex(
              event.host.x,
              width,
              state.buffers.axisCount,
            );
            viewportDragState = {
              axisIndex,
              currentY: event.host.y,
              kind: event.button === 0 ? 'zoom' : 'pan',
              pointerId: event.pointerId,
              startViewports: {
                ...state.axisViewports,
              },
              startY: event.host.y,
            };
            viewportOverlay.dataset.axis =
              state.buffers.axisOrder[axisIndex] ?? '';
            viewportOverlay.dataset.interaction = viewportDragState.kind;
            updateViewportOverlay(plot, viewportOverlay, viewportDragState);
            return;
          }
        }

        if (
          event.type === 'pointermove' &&
          viewportDragState !== null &&
          event.pointerId === viewportDragState.pointerId
        ) {
          moveViewportDrag(event);
          return;
        }

        if (
          (event.type === 'pointerup' || event.type === 'pointercancel') &&
          viewportDragState !== null &&
          event.pointerId === viewportDragState.pointerId
        ) {
          finishViewportDrag(event);
          return;
        }

        if (
          event.type === 'pointermove' &&
          dragState !== null &&
          event.pointerId === dragState.pointerId
        ) {
          scheduleBrushDragMove(event);
          return;
        }

        if (
          (event.type === 'pointerup' || event.type === 'pointercancel') &&
          dragState !== null &&
          event.pointerId === dragState.pointerId
        ) {
          finishBrushDrag(event);
          return;
        }

        if (event.type === 'pointermove') {
          if (
            event.modifiers.shiftKey ||
            options.inspection?.explicitHoverModeActive?.() === true
          ) {
            pendingInspection.schedule(event);
          } else if (latestInspectionActive) {
            pendingInspection.cancel();
            inspectionRequestSequence += 1;
            clearInspection(plot);
            latestInspectionActive = false;
          }
        }
      })),
    );
    disposables.push(
      toDisposable(inputAdapter.on('key', (event) => {
        if (event.type === 'keyup' && event.key === 'Shift') {
          if (options.inspection?.explicitHoverModeActive?.() === true) {
            return;
          }
          pendingInspection.cancel();
          inspectionRequestSequence += 1;
          if (latestInspectionActive) {
            clearInspection(plot);
            latestInspectionActive = false;
          }
          return;
        }
        handleKey(plot, event, options);
      })),
    );
    disposables.push(
      addEventListenerDisposable(inputElement, 'dblclick', (event) => {
        if (brushHitTest === null) {
          return;
        }
        if (event.button !== 2) {
          return;
        }
        const pointerEvent = normalizePointerEvent(
          coordinateTarget,
          event,
          'pointerdown',
        );
        const hit = brushHitTest(pointerEvent, plot);
        if (
          hit === null ||
          hit.axisRangeIndex === undefined ||
          hit.axisRangeIndex < 0
        ) {
          return;
        }
        event.preventDefault();
        plot.commands.removeBrushInterval(hit.axis, hit.axisRangeIndex, {
          reason: 'remove',
          source: 'pointer',
        });
      }),
    );
    disposables.push(
      addEventListenerDisposable(inputElement, 'pointerleave', () => {
        pendingInspection.cancel();
        inspectionRequestSequence += 1;
        if (latestInspectionActive) {
          clearInspection(plot);
          latestInspectionActive = false;
        }
      }),
    );
    const inputWindow = inputElement.ownerDocument.defaultView;
    if (inputWindow != null) {
      disposables.push(
        addEventListenerDisposable(inputWindow, 'keyup', (event) => {
          if (event.key !== 'Shift') {
            return;
          }
          if (options.inspection?.explicitHoverModeActive?.() === true) {
            return;
          }
          pendingInspection.cancel();
          if (latestInspectionActive) {
            clearInspection(plot);
            latestInspectionActive = false;
          }
        }),
      );
      disposables.push(
        addEventListenerDisposable(inputWindow, 'pointermove', (event) => {
          if (dragState === null && viewportDragState === null) {
            return;
          }
          if (eventStartedInsideInputTarget(event, inputElement)) {
            return;
          }
          const normalized = normalizePointerEvent(
            coordinateTarget,
            event,
            'pointermove',
          );
          if (viewportDragState !== null) {
            moveViewportDrag(normalized);
          } else {
            scheduleBrushDragMove(normalized);
          }
        }),
      );
      const handleWindowPointerEnd = (event: PointerEvent | MouseEvent) => {
        if (dragState === null && viewportDragState === null) {
          return;
        }
        const normalized = normalizePointerEvent(
          coordinateTarget,
          event,
          event.type === 'pointercancel' ? 'pointercancel' : 'pointerup',
        );
        normalized.originalEvent.preventDefault();
        if (viewportDragState !== null) {
          if (
            'pointerId' in event &&
            normalized.pointerId !== viewportDragState.pointerId &&
            event.type !== 'mouseup'
          ) {
            return;
          }
          finishViewportDrag(normalized);
        } else if (dragState !== null) {
          if (
            'pointerId' in event &&
            normalized.pointerId !== dragState.pointerId &&
            event.type !== 'mouseup'
          ) {
            return;
          }
          finishBrushDrag(normalized);
        }
      };
      disposables.push(
        addEventListenerDisposable(inputWindow, 'pointerup', handleWindowPointerEnd),
      );
      disposables.push(
        addEventListenerDisposable(
          inputWindow,
          'pointercancel',
          handleWindowPointerEnd,
        ),
      );
      disposables.push(
        addEventListenerDisposable(inputWindow, 'mouseup', handleWindowPointerEnd),
      );
    }
    if (options.keyboardTarget !== undefined) {
      disposables.push(
        addEventListenerDisposable(options.keyboardTarget, 'keydown', (event) => {
          handleKey(plot, normalizeExternalKeyEvent(event), options);
        }),
      );
    }

    return toDisposable(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });
  };
}

function updateViewportOverlay(
  plot: ParallelFastPlotInstance,
  overlay: HTMLDivElement,
  drag: ParallelFastViewportDragState,
): void {
  const state = plot.commands.getStateSnapshot();
  const rect = plot.commands.getHostElement().getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const normalAxis = getParallelNormalAxisGeometry(rect.height);
  const axisX = parallelAxisPosition(drag.axisIndex, width, state.buffers.axisCount);
  overlay.style.display = 'block';
  overlay.style.left = `${axisX}px`;
  if (drag.kind === 'pan') {
    const deltaY = drag.currentY - drag.startY;
    overlay.style.borderStyle = 'dashed';
    overlay.style.height = `${normalAxis.height}px`;
    overlay.style.top = `${normalAxis.top + deltaY}px`;
    return;
  }
  const firstY = clampNumber(drag.startY, normalAxis.top, normalAxis.bottom);
  const secondY = clampNumber(drag.currentY, normalAxis.top, normalAxis.bottom);
  const top = Math.min(firstY, secondY);
  overlay.style.borderStyle = 'solid';
  overlay.style.top = `${top}px`;
  overlay.style.height = `${Math.abs(secondY - firstY)}px`;
}

function createDraggedAxisViewports(
  plot: ParallelFastPlotInstance,
  drag: ParallelFastViewportDragState,
): import('../core/index.js').ParallelAxisViewports {
  const state = plot.commands.getStateSnapshot();
  const { buffers } = state;
  const rect = plot.commands.getHostElement().getBoundingClientRect();
  const normalAxis = getParallelNormalAxisGeometry(rect.height);
  const startViewports = drag.startViewports;
  const next = { ...startViewports };
  const axis = buffers.axisOrder[drag.axisIndex];
  const domain = axis === undefined ? undefined : buffers.domainsByAxis[axis];
  if (axis === undefined || domain === undefined || domain.span <= 0) return next;
  const initial = startViewports[axis] ?? domain;
  const span = initial.max - initial.min;
  if (drag.kind === 'zoom') {
    const first =
      initial.max -
      clamp01((drag.startY - normalAxis.top) / normalAxis.height) * span;
    const second =
      initial.max -
      clamp01((drag.currentY - normalAxis.top) / normalAxis.height) * span;
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    if (max > min) next[axis] = { max, min };
    return next;
  }
  const delta = ((drag.currentY - drag.startY) / normalAxis.height) * span;
  let min = initial.min + delta;
  let max = initial.max + delta;
  if (min < domain.min) {
    max += domain.min - min;
    min = domain.min;
  }
  if (max > domain.max) {
    min -= max - domain.max;
    max = domain.max;
  }
  next[axis] = { max, min };
  return next;
}

function getParallelNormalAxisGeometry(plotHeight: number): {
  bottom: number;
  height: number;
  top: number;
} {
  const height = Math.max(1, plotHeight);
  const top = height * (1 - PARALLEL_AXIS_MAX_DISPLAY_VALUE);
  const bottom = height * (1 - PARALLEL_AXIS_MIN_DISPLAY_VALUE);
  return {
    bottom,
    height: Math.max(1, bottom - top),
    top,
  };
}

function parallelAxisPosition(
  axisIndex: number,
  width: number,
  axisCount: number,
): number {
  if (axisCount <= 1) return width / 2;
  return (axisIndex / (axisCount - 1)) * width;
}

function closestParallelAxisIndex(
  x: number,
  width: number,
  axisCount: number,
): number {
  if (axisCount <= 1) return 0;
  return Math.max(
    0,
    Math.min(axisCount - 1, Math.round(clamp01(x / width) * (axisCount - 1))),
  );
}

function isInteractivePointerTarget(target: EventTarget | null): boolean {
  if (
    target === null ||
    typeof (target as { closest?: unknown }).closest !== 'function'
  ) {
    return false;
  }
  return (
    (target as Element).closest(
      'a,button,input,select,textarea,[contenteditable="true"],[role="button"]',
    ) !== null
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function startBrushDrag(
  plot: ParallelFastPlotInstance,
  hit: ParallelFastBrushHit,
  event: NormalizedPointerEvent,
  defaultAction: ParallelFastBrushDefaultAction,
  setDragState: (
    dragState: ParallelFastBrushDragState,
    initialRange: NumericRange,
  ) => void,
): void {
  const fullState = plot.commands.getStateSnapshot();
  const currentRanges =
    hit.kind === 'create' && !event.modifiers.ctrlKey
      ? []
      : getBrushRangesForAxis(fullState.brush.brushIntervals, hit.axis);
  const effectiveAxisRangeIndex =
    defaultAction === 'none'
      ? 0
      : hit.kind === 'create'
        ? event.modifiers.ctrlKey
          ? currentRanges.length
          : 0
        : hit.axisRangeIndex ?? -1;
  const originalRange =
    effectiveAxisRangeIndex >= 0
      ? currentRanges[effectiveAxisRangeIndex] ?? null
      : null;
  const completeDomain = fullState.buffers.domainsByAxis[hit.axis];
  if (completeDomain === undefined) {
    return;
  }
  const viewport = fullState.axisViewports[hit.axis];
  const axisDomainValue =
    viewport === null || viewport === undefined
      ? completeDomain
      : {
          max: viewport.max,
          min: viewport.min,
          span: viewport.max - viewport.min,
        };
  const startRawValue = rawValueFromClientY(
    event.client.y,
    hit.axisBounds,
    axisDomainValue,
  );
  const dragState: ParallelFastBrushDragState = {
    axis: hit.axis,
    axisBounds: hit.axisBounds,
    axisRangeIndex: effectiveAxisRangeIndex,
    currentRange: normalizeRange({ max: startRawValue, min: startRawValue }),
    defaultAction,
    domain: axisDomainValue,
    kind: hit.kind,
    modifiers: event.modifiers,
    originalRange,
    pointerId: event.pointerId,
    startRawValue,
  };
  const initialRange =
    hit.kind === 'create'
      ? normalizeRange({ max: startRawValue, min: startRawValue })
      : createDraggedBrushRange(startRawValue, dragState);
  dragState.currentRange = initialRange;
  setDragState(dragState, initialRange);
}

function resolveInspection(
  plot: ParallelFastPlotInstance,
  event: NormalizedPointerEvent,
  options: ParallelFastInspectionOptions | undefined,
  requestSequence: number,
  getRequestSequence: () => number,
): void {
  const buffers = getBuffersFromPlot(plot);
  const rect = plot.commands.getHostElement().getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const startedAt = performance.now();
  const axisPosition =
    (event.host.x / width) * Math.max(0, buffers.axisCount - 1);
  const normalizedValue = parallelDisplayValueToRenderedNormalizedValue(
    1 - event.host.y / height,
  );
  const hoverIndex = options?.getHoverIndex?.() ?? null;
  const maxDistancePx = options?.maxDistancePx ?? 28;
  const fallbackLimit = options?.smallDatasetFallbackRecordLimit ?? 20_000;
  const rendererLookup = plot.commands.resolveInspectionAtPoint({
    axisPosition,
    maxDistancePx,
    normalizedValue,
    plotHeightPx: height,
    plotWidthPx: width,
  });
  if (rendererLookup !== null) {
    void rendererLookup.then((nearest) => {
      if (requestSequence !== getRequestSequence()) return;
      const resolveMs = performance.now() - startedAt;
      applyResolvedInspection(plot, nearest, resolveMs, 'index');
    });
    return;
  }
  const nearest =
    hoverIndex === null
      ? buffers.recordCount < fallbackLimit
        ? findNearestParallelRecordByPoint({
            axisPosition,
            buffers,
            maxDistancePx,
            normalizedValue,
            plotHeightPx: height,
            plotWidthPx: width,
          })
        : null
      : findNearestParallelRecordByIndexedPoint({
          axisPosition,
          buffers,
          index: hoverIndex,
          maxDistancePx,
          normalizedValue,
          plotHeightPx: height,
          plotWidthPx: width,
        });
  const resolveMs = performance.now() - startedAt;
  applyResolvedInspection(
    plot,
    nearest,
    resolveMs,
    hoverIndex === null
      ? buffers.recordCount < fallbackLimit
        ? 'fallback'
        : 'none'
      : 'index',
  );
}

function applyResolvedInspection(
  plot: ParallelFastPlotInstance,
  nearest: ReturnType<typeof findNearestParallelRecordByPoint>,
  resolveMs: number,
  lookupSource: 'fallback' | 'index' | 'none',
): void {
  plot.commands.setHoverState({
    dimBackground: false,
    sourceIndex: nearest?.recordIndex ?? null,
  });
  plot.commands.setInspection(
    nearest === null ? null : { ...nearest, source: 'local-nearest-segment' },
    {
      lookupSource,
      resolveMs,
      source: 'pointer',
    },
  );
}

function clearInspection(plot: ParallelFastPlotInstance): void {
  plot.commands.setHoverState({ dimBackground: false, sourceIndex: null });
  plot.commands.clearInspection({ lookupSource: 'none', source: 'pointer' });
}

function handleKey(
  plot: ParallelFastPlotInstance,
  event: NormalizedKeyEvent,
  options: Pick<
    DefaultParallelBindingsOptions,
    'ignoreKeyboardTarget' | 'shortcutGate'
  > = {},
): void {
  if (event.type !== 'keydown') {
    return;
  }
  if (event.defaultPrevented) {
    return;
  }
  if (options.shortcutGate?.() === false) {
    return;
  }
  if (options.ignoreKeyboardTarget?.(event.originalEvent.target) === true) {
    return;
  }
  if (event.modifiers.altKey || event.modifiers.ctrlKey || event.modifiers.metaKey) {
    return;
  }
  if (event.key === 'Escape') {
    if (event.repeat || plot.commands.getStateSnapshot().brush.activeBrushes.length === 0) {
      return;
    }
    event.originalEvent.preventDefault();
    plot.commands.clearBrushes({ source: 'keyboard' });
    return;
  }
  const key = event.key.toLowerCase();
  const code = event.code.toLowerCase();
  if (key === '0' || code === 'digit0' || code === 'numpad0') {
    event.originalEvent.preventDefault();
    plot.commands.requestLineOpacityAdjustment('reset', { source: 'keyboard' });
    return;
  }
  if (key === ',' || key === '-' || code === 'comma' || code === 'minus') {
    event.originalEvent.preventDefault();
    plot.commands.requestLineOpacityAdjustment('decrease', { source: 'keyboard' });
    return;
  }
  if (key === '.' || key === '+' || code === 'period' || code === 'equal') {
    event.originalEvent.preventDefault();
    plot.commands.requestLineOpacityAdjustment('increase', { source: 'keyboard' });
  }
}

function brushReasonForDragKind(
  kind: ParallelFastBrushDragKind,
): ParallelFastBrushChangeReason {
  if (kind === 'max') {
    return 'resize-max';
  }
  if (kind === 'min') {
    return 'resize-min';
  }
  return kind;
}

function createTransientParallelBrushEvent(
  dragState: ParallelFastBrushDragState,
  phase: 'preview' | 'commit',
  event: NormalizedPointerEvent | undefined,
): ParallelFastBrushEvent {
  const range = normalizeRange(dragState.currentRange);
  const value = normalizeBrushNumericRange(range);
  return {
    activeBrushes: [
      {
        axisRangeIndex: dragState.axisRangeIndex,
        max: value.max,
        min: value.min,
        parameter: dragState.axis,
      },
    ],
    brushIntervals: {
      [dragState.axis]: [
        {
          max: value.max,
          min: value.min,
        },
      ],
    },
    defaultAction: dragState.defaultAction,
    modifiers: snapshotBrushModifiers(event?.modifiers ?? dragState.modifiers),
    phase,
    range: {
      intervals: [
        {
          axis: dragState.axis,
          axisRangeIndex: dragState.axisRangeIndex,
          max: value.max,
          min: value.min,
          parameterKey: dragState.axis,
        },
      ],
      value,
    },
    reason: brushReasonForDragKind(dragState.kind),
    shape: 'axis-range',
    source: 'pointer',
    target: {
      axis: dragState.axis,
      axisRangeIndex: dragState.axisRangeIndex,
      parameterKey: dragState.axis,
    },
  };
}

function emitTransientParallelBrushEvent(
  plot: ParallelFastPlotInstance,
  dragState: ParallelFastBrushDragState,
  phase: 'preview' | 'commit',
  event: NormalizedPointerEvent | undefined,
): void {
  const brushEvent = createTransientParallelBrushEvent(dragState, phase, event);
  plot.commands.setOverlays([
    {
      activeBrushes: brushEvent.activeBrushes,
      brushIntervals: brushEvent.brushIntervals,
      id: 'color-rule-brush',
      kind: 'color-rule-brush',
    },
  ]);
  plot.commands.emitBrushEvent(brushEvent);
}

function resolveAxisBrushGesture(
  event: NormalizedPointerEvent,
  gestures: readonly ParallelFastAxisBrushGesture[] | undefined,
): ParallelFastAxisBrushGesture | null {
  if (event.type !== 'pointerdown' || gestures === undefined) {
    return null;
  }
  return (
    gestures.find(
      (gesture) =>
        gesture.button === event.button &&
        modifiersMatch(event.modifiers, gesture.modifiers),
    ) ?? null
  );
}

function modifiersMatch(
  actual: InputModifiers,
  expected: Partial<InputModifiers> | undefined,
): boolean {
  const normalizedExpected = expected ?? {};
  return (
    actual.altKey === (normalizedExpected.altKey ?? false) &&
    actual.ctrlKey === (normalizedExpected.ctrlKey ?? false) &&
    actual.metaKey === (normalizedExpected.metaKey ?? false) &&
    actual.shiftKey === (normalizedExpected.shiftKey ?? false)
  );
}

export interface ParallelDomBrushHitTestOptions {
  axisGuideSelector?: string;
  brushBandSelector?: string;
  brushHandleMaxSelector?: string;
  brushHandleMinSelector?: string;
  brushSelector?: string;
}

export function createParallelDomBrushHitTest(
  options: ParallelDomBrushHitTestOptions = {},
): ParallelFastBrushHitTest {
  const axisGuideSelector = options.axisGuideSelector ?? '.parallel-fast-axis-guide';
  const brushSelector = options.brushSelector ?? '.parallel-fast-axis-brush';
  const brushHandleMaxSelector =
    options.brushHandleMaxSelector ?? '.parallel-fast-axis-brush-handle-max';
  const brushHandleMinSelector =
    options.brushHandleMinSelector ?? '.parallel-fast-axis-brush-handle-min';
  const brushBandSelector = options.brushBandSelector ?? '.parallel-fast-axis-brush-band';

  return (event) => {
    const target =
      event.originalEvent.target instanceof Element
        ? event.originalEvent.target
        : null;
    const axisElement = target?.closest<HTMLElement>(axisGuideSelector);
    if (!axisElement) {
      return null;
    }
    const axis = axisElement.dataset.axis;
    if (!axis) {
      return null;
    }
    const brushElement = target?.closest<HTMLElement>(brushSelector);
    const axisRangeIndex = Number(brushElement?.dataset.axisRangeIndex ?? -1);
    const kind = target?.closest(brushHandleMaxSelector)
      ? 'max'
      : target?.closest(brushHandleMinSelector)
        ? 'min'
        : target?.closest(brushBandSelector)
          ? 'move'
          : 'create';
    const rect = axisElement.getBoundingClientRect();
    return {
      axis,
      axisBounds: { height: rect.height, top: rect.top },
      axisRangeIndex,
      kind,
    };
  };
}

function normalizeExternalKeyEvent(event: Event): NormalizedKeyEvent {
  const keyEvent = event as KeyboardEvent;
  return {
    code: keyEvent.code,
    defaultPrevented: event.defaultPrevented,
    key: keyEvent.key,
    modifiers: {
      altKey: keyEvent.altKey,
      ctrlKey: keyEvent.ctrlKey,
      metaKey: keyEvent.metaKey,
      shiftKey: keyEvent.shiftKey,
    },
    originalEvent: event,
    repeat: keyEvent.repeat,
    timeStamp: event.timeStamp,
    type: 'keydown',
  };
}

function getBuffersFromPlot(plot: ParallelFastPlotInstance) {
  return plot.commands.getStateSnapshot().buffers;
}

function updateAxisBrushInterval(
  currentBrushIntervals: ParallelBrushIntervals,
  parameter: ParallelParameter,
  axisRangeIndex: number,
  range: NumericRange,
): ParallelBrushIntervals {
  const currentRanges = getBrushRangesForAxis(currentBrushIntervals, parameter);
  const nextRanges = [...currentRanges];
  nextRanges[axisRangeIndex < 0 ? nextRanges.length : axisRangeIndex] =
    normalizeRange(range);
  return {
    ...currentBrushIntervals,
    [parameter]: nextRanges,
  };
}

function clearAxisBrushIntervals(
  currentBrushIntervals: ParallelBrushIntervals,
  parameter: ParallelParameter,
): ParallelBrushIntervals {
  if (currentBrushIntervals[parameter] === undefined) {
    return currentBrushIntervals;
  }
  const nextBrushIntervals = { ...currentBrushIntervals };
  delete nextBrushIntervals[parameter];
  return nextBrushIntervals;
}

function getBrushRangesForAxis(
  brushIntervals: ParallelBrushIntervals,
  parameter: ParallelParameter,
): NumericRange[] {
  const interval = brushIntervals[parameter];
  if (interval === null || interval === undefined) {
    return [];
  }
  return Array.isArray(interval)
    ? [...(interval as readonly NumericRange[])]
    : [interval as NumericRange];
}

function createDraggedBrushRange(
  rawValue: number,
  dragState: ParallelFastBrushDragState,
): NumericRange {
  if (dragState.kind === 'create' || dragState.originalRange === null) {
    return normalizeRange({
      max: rawValue,
      min: dragState.startRawValue,
    });
  }
  const originalRange = normalizeRange(dragState.originalRange);
  if (dragState.kind === 'max') {
    return clampRangeToDomain(
      { max: rawValue, min: originalRange.min },
      dragState.domain,
    );
  }
  if (dragState.kind === 'min') {
    return clampRangeToDomain(
      { max: originalRange.max, min: rawValue },
      dragState.domain,
    );
  }
  const delta = rawValue - dragState.startRawValue;
  const span = originalRange.max - originalRange.min;
  let nextMin = originalRange.min + delta;
  let nextMax = originalRange.max + delta;
  if (nextMin < dragState.domain.min) {
    nextMin = dragState.domain.min;
    nextMax = nextMin + span;
  }
  if (nextMax > dragState.domain.max) {
    nextMax = dragState.domain.max;
    nextMin = nextMax - span;
  }
  return clampRangeToDomain({ max: nextMax, min: nextMin }, dragState.domain);
}

function clampRangeToDomain(
  range: NumericRange,
  domain: { max: number; min: number },
): NumericRange {
  const normalizedRange = normalizeRange(range);
  return normalizeRange({
    max: clampNumber(normalizedRange.max, domain.min, domain.max),
    min: clampNumber(normalizedRange.min, domain.min, domain.max),
  });
}

function normalizeRange(range: NumericRange): NumericRange {
  return {
    max: Math.max(range.min, range.max),
    min: Math.min(range.min, range.max),
  };
}

function rawValueFromClientY(
  clientY: number,
  axisBounds: ParallelFastAxisBounds,
  domain: { max: number; min: number; span: number },
): number {
  if (axisBounds.height <= 0 || domain.span === 0) {
    return domain.min;
  }
  const normalized = clampNumber(
    parallelDisplayValueToRenderedNormalizedValue(
      1 - (clientY - axisBounds.top) / axisBounds.height,
    ),
    0,
    1,
  );
  return domain.min + normalized * domain.span;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function capturePointer(event: Event | undefined, pointerId: number): void {
  const target = event?.currentTarget;
  if (
    target !== null &&
    target !== undefined &&
    'setPointerCapture' in target &&
    typeof target.setPointerCapture === 'function'
  ) {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Some DOM targets reject capture for synthetic or already-ended pointers.
    }
  }
}

function eventStartedInsideInputTarget(event: Event, inputTarget: HTMLElement): boolean {
  const target = event.target;
  const NodeCtor = inputTarget.ownerDocument.defaultView?.Node ?? globalThis.Node;
  return (
    target !== null &&
    typeof NodeCtor !== 'undefined' &&
    target instanceof NodeCtor &&
    inputTarget.contains(target)
  );
}
