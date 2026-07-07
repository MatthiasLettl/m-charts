import {
  addEventListenerDisposable,
  DisposableStack,
  createDomInputAdapter,
  createLatestRafScheduler,
  normalizePointerEvent,
  normalizeBrushNumericRange,
  snapshotBrushModifiers,
  type BrushCssGeometry,
  type BrushPhase,
  type InputModifiers,
  type NormalizedKeyEvent,
  type NormalizedPointerEvent,
  type NormalizedWheelEvent,
} from '../../plot-engine/core/index.js';
import {
  createHistogramMeasurementReference,
  createHistogramRectangleZoomFeedback,
  histogramPixelToAxis,
  type HistogramAxisMode,
  type HistogramPlotRect,
  type HistogramPoint,
  type HistogramRectangleZoomAxisModeStrategy,
  type HistogramSelectionKind,
  type HistogramViewport,
} from '../core/index.js';
import type { HistogramBinding, HistogramPlotInstance } from './types.js';
import type {
  HistogramBrushDefaultAction,
  HistogramBrushEvent,
  HistogramBrushRange,
} from './histogramEvents.js';

export interface DefaultHistogramBindingsOptions {
  inputElement?: HTMLElement;
  rectangleBrushGestures?: readonly HistogramRectangleBrushGesture[];
  suppressContextMenu?: boolean;
}

export interface HistogramRectangleBrushGesture {
  axisMode?: HistogramAxisMode | 'auto';
  button: 0 | 2;
  defaultAction: Extract<HistogramBrushDefaultAction, 'none' | 'zoom'>;
  modifiers?: Partial<InputModifiers>;
}

type HistogramPointerDrag =
  | MiddleDrag
  | RectangleZoomDrag
  | RectangleSelectionDrag
  | LassoSelectionDrag
  | MeasurementDrag;

interface MiddleDrag {
  kind: 'middle';
  pointerId: number;
  startViewport: HistogramViewport;
  subplotId: string;
  updateCount: number;
  x: number;
  y: number;
}

interface RectangleZoomDrag {
  axisMode: HistogramAxisMode;
  axisModeStrategy: HistogramRectangleZoomAxisModeStrategy;
  defaultAction: Extract<HistogramBrushDefaultAction, 'none' | 'zoom'>;
  kind: 'rectangle-zoom';
  modifiers: NormalizedPointerEvent['modifiers'];
  plotRect: HistogramPlotRect;
  pointerId: number;
  startedAt: number;
  x: number;
  y: number;
}

interface RectangleSelectionDrag {
  kind: 'rectangle-selection';
  modifiers: NormalizedPointerEvent['modifiers'];
  plotRect: HistogramPlotRect;
  pointerId: number;
  selectionKind: HistogramSelectionKind;
  x: number;
  y: number;
}

interface LassoSelectionDrag {
  kind: 'lasso';
  modifiers: NormalizedPointerEvent['modifiers'];
  pixelPoints: HistogramPoint[];
  plotRect: HistogramPlotRect;
  pointerId: number;
  selectionKind: HistogramSelectionKind;
}

interface MeasurementDrag {
  kind: 'measurement';
  pointerId: number;
  reference: NonNullable<ReturnType<HistogramPlotInstance['commands']['getBinAtPoint']>>;
}

const MIDDLE_CLICK_MAX_MOVE_CSS_PX = 3;

export function createDefaultHistogramBindings(
  options: DefaultHistogramBindingsOptions = {},
): HistogramBinding {
  return {
    attach(plot) {
      const disposables = new DisposableStack();
      const inputTarget = options.inputElement ?? plot.hostElement.parentElement ?? plot.hostElement;
      const input = createDomInputAdapter(inputTarget, {
        coordinateTarget: plot.hostElement,
        suppressContextMenu: options.suppressContextMenu,
      });
      disposables.add(input);

      let pointerDrag: HistogramPointerDrag | null = null;
      let lastPointerEvent: NormalizedPointerEvent | null = null;
      let spaceHeld = false;
      let shiftHeld = false;
      const hoverScheduler = createLatestRafScheduler<NormalizedPointerEvent>((event) => {
        if (!event.modifiers.shiftKey || pointerDrag !== null) {
          return;
        }
        const hover = plot.commands.hoverAtPoint({
          pointerCssX: event.host.x,
          pointerCssY: event.host.y,
          source: 'shift-hover',
        });
        if (hover !== null) {
          plot.commands.setCursorState('default', 'pointer');
        }
      });
      disposables.add(hoverScheduler);

      input.on('wheel', (event) => {
        handleWheel(plot, event);
      });
      input.on('pointer', (event) => {
        const normalizedEvent = withHeldShiftModifier(event, shiftHeld);
        if (normalizedEvent.type === 'pointermove') {
          lastPointerEvent = normalizedEvent;
        }
        pointerDrag = handlePointer(
          plot,
          normalizedEvent,
          pointerDrag,
          spaceHeld,
          hoverScheduler,
          options,
        );
      });
      input.on('key', (event) => {
        if (isSpaceKey(event)) {
          spaceHeld =
            event.type === 'keydown' &&
            !shouldIgnoreSpaceShortcutTarget(event.originalEvent.target);
        }
        handleKey(plot, event, hoverScheduler);
      });
      input.on('blur', () => {
        clearTransientInspection(plot, hoverScheduler);
      });

      if (typeof globalThis.window !== 'undefined') {
        const handleWindowPointerEnd = (event: PointerEvent | MouseEvent) => {
          if (pointerDrag === null) {
            return;
          }
          const normalized = normalizePointerEvent(
            plot.hostElement,
            event,
            event.type === 'pointercancel' ? 'pointercancel' : 'pointerup',
          );
          pointerDrag = handlePointer(
            plot,
            {
              ...normalized,
              pointerId: pointerDrag.pointerId,
              modifiers: {
                ...normalized.modifiers,
                shiftKey: normalized.modifiers.shiftKey || shiftHeld,
              },
            },
            pointerDrag,
            spaceHeld,
            hoverScheduler,
            options,
          );
        };
        disposables.add(
          addEventListenerDisposable(globalThis.window, 'pointerup', handleWindowPointerEnd),
        );
        disposables.add(
          addEventListenerDisposable(globalThis.window, 'pointercancel', handleWindowPointerEnd),
        );
        disposables.add(
          addEventListenerDisposable(globalThis.window, 'mouseup', handleWindowPointerEnd),
        );
        disposables.add(
          addEventListenerDisposable(globalThis.window, 'pointermove', (event) => {
            if (pointerDrag !== null) {
              if (eventStartedInsideInputTarget(event, inputTarget)) {
                return;
              }
              const normalized = normalizePointerEvent(plot.hostElement, event, 'pointermove');
              pointerDrag = handlePointer(
                plot,
                {
                  ...normalized,
                  modifiers: {
                    ...normalized.modifiers,
                    shiftKey: normalized.modifiers.shiftKey || shiftHeld,
                  },
                },
                pointerDrag,
                spaceHeld,
                hoverScheduler,
                options,
              );
              return;
            }
            if (!event.shiftKey && !shiftHeld) {
              return;
            }
            const normalized = normalizePointerEvent(plot.hostElement, event, 'pointermove');
            lastPointerEvent = {
              ...normalized,
              modifiers: {
                ...normalized.modifiers,
                shiftKey: true,
              },
            };
            pointerDrag = handlePointer(
              plot,
              lastPointerEvent,
              pointerDrag,
              spaceHeld,
              hoverScheduler,
              options,
            );
          }),
        );
        disposables.add(
          addEventListenerDisposable(globalThis.window, 'keyup', (event) => {
            if (isKeyboardSpaceKey(event)) {
              spaceHeld = false;
            }
            if (event.key === 'Shift') {
              shiftHeld = false;
            }
            handleKey(plot, normalizeWindowKeyEvent(event), hoverScheduler);
          }),
        );
        disposables.add(
          addEventListenerDisposable(globalThis.window, 'keydown', (event) => {
            if (isKeyboardSpaceKey(event) && !shouldIgnoreSpaceShortcutTarget(event.target)) {
              spaceHeld = true;
              if (isPointerOverPlot(plot, lastPointerEvent)) {
                event.preventDefault();
              }
            }
            if (event.key === 'Shift') {
              shiftHeld = true;
              if (lastPointerEvent !== null && pointerDrag === null) {
                const shiftedEvent = withHeldShiftModifier(lastPointerEvent, true);
                const plotRect = plot.commands.getPlotRectAtPoint(
                  shiftedEvent.host.x,
                  shiftedEvent.host.y,
                );
                plot.commands.setCursorState('default', 'pointer');
                if (plotRect !== null) {
                  hoverScheduler.schedule(shiftedEvent);
                }
              }
            }
            handleKey(plot, normalizeWindowKeyEvent(event), hoverScheduler);
          }),
        );
      }

      return disposables;
    },
  };
}

function handleWheel(plot: HistogramPlotInstance, event: NormalizedWheelEvent): void {
  const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
  if (plotRect === null) {
    return;
  }

  plot.commands.setActivePlot(plotRect.id, 'pointer');
  const axisMode = resolveWheelZoomAxisMode(event);
  const deltaY = resolveWheelZoomDeltaY(event, axisMode);
  if (deltaY === null) {
    return;
  }

  consumeNativeInteraction(event.originalEvent);
  if (axisMode !== null) {
    plot.commands.zoomAtPointer({
      axisMode,
      deltaMode: event.deltaMode,
      deltaY,
      pointerCssX: event.host.x,
      pointerCssY: event.host.y,
    });
    return;
  }

  const snapshot = plot.commands.getStateSnapshot();
  if (snapshot.aggregation.mode !== 'histogram') {
    return;
  }
  const binSize = snapshot.binSizes.find(
    (candidate) => candidate.subplotId === plotRect.id && candidate.mode === 'continuous',
  );
  if (binSize === undefined) {
    return;
  }
  plot.commands.requestBinSizeAdjust({
    binSize,
    delta: deltaY < 0 ? -1 : 1,
    source: 'wheel',
    subplotId: plotRect.id,
  });
}

function handlePointer(
  plot: HistogramPlotInstance,
  event: NormalizedPointerEvent,
  pointerDrag: HistogramPointerDrag | null,
  lassoHeld: boolean,
  hoverScheduler?: ReturnType<typeof createLatestRafScheduler<NormalizedPointerEvent>>,
  options: Pick<DefaultHistogramBindingsOptions, 'rectangleBrushGestures'> = {},
): HistogramPointerDrag | null {
  if (event.type === 'pointerdown' && event.button === 2 && event.modifiers.shiftKey) {
    const hit = plot.commands.getBinAtPoint(event.host.x, event.host.y);
    if (hit === null) {
      return null;
    }
    const reference = createHistogramMeasurementReference(hit);
    if (reference === null) {
      return null;
    }
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setMeasurement({ current: reference, reference });
    plot.commands.setCursorState('default', 'pointer');
    return {
      kind: 'measurement',
      pointerId: event.pointerId,
      reference: hit,
    };
  }

  const rectangleBrushGesture = resolveRectangleBrushGesture(
    event,
    options.rectangleBrushGestures,
  );
  if (event.type === 'pointerdown' && event.button === 0 && rectangleBrushGesture !== null) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect === null) {
      return null;
    }
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');

    plot.commands.setCursorState('crosshair', 'pointer');
    const axisMode = resolveRectangleBrushGestureAxisMode(rectangleBrushGesture);
    const drag: RectangleZoomDrag = {
      axisMode: axisMode.axisMode,
      axisModeStrategy: axisMode.axisModeStrategy,
      defaultAction: rectangleBrushGesture.defaultAction,
      kind: 'rectangle-zoom',
      modifiers: event.modifiers,
      plotRect,
      pointerId: event.pointerId,
      startedAt: performance.now(),
      x: event.host.x,
      y: event.host.y,
    };
    updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
    emitHistogramBrushEvent(plot, drag, 'start', event, rectangleBrushGesture.defaultAction);
    return drag;
  }

  if (event.type === 'pointerdown' && event.button === 0 && !event.modifiers.shiftKey) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect === null) {
      return null;
    }
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');

    plot.commands.setCursorState('crosshair', 'pointer');
    const drag: RectangleZoomDrag = {
      axisMode: 'xy',
      axisModeStrategy: 'auto',
      defaultAction: 'zoom',
      kind: 'rectangle-zoom',
      modifiers: event.modifiers,
      plotRect,
      pointerId: event.pointerId,
      startedAt: performance.now(),
      x: event.host.x,
      y: event.host.y,
    };
    updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
    emitHistogramBrushEvent(plot, drag, 'start', event, 'zoom');
    return drag;
  }

  if (event.type === 'pointerdown' && isForcedXYRectangleZoomGesture(event)) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect === null) {
      return null;
    }
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');

    plot.commands.setCursorState('crosshair', 'pointer');
    const drag: RectangleZoomDrag = {
      axisMode: 'xy',
      axisModeStrategy: 'fixed',
      defaultAction: 'zoom',
      kind: 'rectangle-zoom',
      modifiers: event.modifiers,
      plotRect,
      pointerId: event.pointerId,
      startedAt: performance.now(),
      x: event.host.x,
      y: event.host.y,
    };
    updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
    emitHistogramBrushEvent(plot, drag, 'start', event, 'zoom');
    return drag;
  }

  if (event.type === 'pointerdown' && event.button === 2 && !event.modifiers.shiftKey) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect === null) {
      return null;
    }
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');
    plot.commands.setCursorState('crosshair', 'pointer');
    const selectionKind: HistogramSelectionKind = event.modifiers.ctrlKey ? 'append' : 'replace';
    if (lassoHeld || shouldUseLasso(plot)) {
      const drag: LassoSelectionDrag = {
        kind: 'lasso',
        modifiers: event.modifiers,
        pixelPoints: [{ x: event.host.x, y: event.host.y }],
        plotRect,
        pointerId: event.pointerId,
        selectionKind,
      };
      updateLassoOverlay(plot, drag);
      emitHistogramBrushEvent(plot, drag, 'start', event, 'select');
      return drag;
    }
    const drag: RectangleSelectionDrag = {
      kind: 'rectangle-selection',
      modifiers: event.modifiers,
      plotRect,
      pointerId: event.pointerId,
      selectionKind,
      x: event.host.x,
      y: event.host.y,
    };
    updateRectangleSelectionOverlay(plot, drag, event.host.x, event.host.y);
    emitHistogramBrushEvent(plot, drag, 'start', event, 'select');
    return drag;
  }

  if (event.type === 'pointerdown' && event.button === 1 && !event.modifiers.shiftKey) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect === null) {
      return null;
    }
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');
    plot.commands.setCursorState('default', 'pointer');
    return {
      kind: 'middle',
      pointerId: event.pointerId,
      startViewport: plot.commands.getStateSnapshot().viewport,
      subplotId: plotRect.id,
      updateCount: 0,
      x: event.host.x,
      y: event.host.y,
    };
  }

  if (pointerDrag !== null && event.pointerId === pointerDrag.pointerId) {
    return updatePointerDrag(plot, event, pointerDrag);
  }

  if (event.type !== 'pointermove') {
    return pointerDrag;
  }

  if (event.modifiers.shiftKey) {
    plot.commands.setCursorState('default', 'pointer');
    hoverScheduler?.schedule({
      ...event,
      modifiers: {
        ...event.modifiers,
        shiftKey: true,
      },
    });
    return pointerDrag;
  }

  hoverScheduler?.cancel();
  plot.commands.clearHover('pointer');
  const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
  if (plotRect === null) {
    plot.commands.setCursorState('default', 'pointer');
    return pointerDrag;
  }
  plot.commands.setActivePlot(plotRect.id, 'pointer');
  plot.commands.setCursorState('default', 'pointer');
  return pointerDrag;
}

function updatePointerDrag(
  plot: HistogramPlotInstance,
  event: NormalizedPointerEvent,
  drag: HistogramPointerDrag,
): HistogramPointerDrag | null {
  if (drag.kind === 'rectangle-zoom') {
    if (event.type === 'pointermove') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
      emitHistogramBrushEvent(plot, drag, 'preview', event, drag.defaultAction);
      return drag;
    }
    plot.commands.clearOverlays('rectangle-zoom');
    if (event.type !== 'pointercancel') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      const brushEvent = createHistogramBrushEvent(
        plot,
        drag,
        'commit',
        event,
        drag.defaultAction,
      );
      plot.commands.emitBrushEvent(brushEvent);
      if (
        drag.defaultAction === 'none' &&
        brushEvent.cssGeometry?.shape === 'rectangle'
      ) {
        plot.commands.setOverlays([
          {
            binDescriptors: brushEvent.range?.bins,
            id: 'color-rule-brush',
            kind: 'color-rule-brush',
            rect: brushEvent.cssGeometry.rect,
            subplotId: drag.plotRect.id,
          },
        ]);
      }
      if (drag.defaultAction === 'zoom') {
        plot.commands.zoomToRectangle({
          axisMode: drag.axisMode,
          axisModeStrategy: drag.axisModeStrategy,
          currentPointerCssX: event.host.x,
          currentPointerCssY: event.host.y,
          plotRect: drag.plotRect,
          startPointerCssX: drag.x,
          startPointerCssY: drag.y,
          startedAt: drag.startedAt,
        });
      }
      plot.commands.clearOverlays('rectangle-zoom');
    } else {
      emitHistogramBrushEvent(plot, drag, 'cancel', event, drag.defaultAction);
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  if (drag.kind === 'rectangle-selection') {
    if (event.type === 'pointermove') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      updateRectangleSelectionOverlay(plot, drag, event.host.x, event.host.y);
      emitHistogramBrushEvent(plot, drag, 'preview', event, 'select');
      return drag;
    }
    plot.commands.clearOverlays('rectangle-selection');
    if (event.type !== 'pointercancel') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      const bounds = rectangleSelectionBounds(drag, event.host.x, event.host.y);
      if (bounds === null) {
        emitHistogramBrushEvent(plot, drag, 'cancel', event, 'select');
        plot.commands.setCursorState('default', 'pointer');
        return null;
      }
      emitHistogramBrushEvent(plot, drag, 'commit', event, 'select');
      const selection = plot.commands.selectRectangle({
        bounds,
        kind: drag.selectionKind,
        subplotId: drag.plotRect.id,
      });
      if ((selection === null || selection.selectedBinCount === 0) && drag.selectionKind === 'replace') {
        plot.commands.clearOverlays('committed-selection');
      }
    } else {
      emitHistogramBrushEvent(plot, drag, 'cancel', event, 'select');
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  if (drag.kind === 'lasso') {
    if (event.type === 'pointermove') {
      const last = drag.pixelPoints.at(-1);
      if (
        last === undefined ||
        Math.hypot(event.host.x - last.x, event.host.y - last.y) >= 2
      ) {
        drag.pixelPoints.push({ x: event.host.x, y: event.host.y });
        updateLassoOverlay(plot, drag);
        drag.modifiers = event.modifiers;
        emitHistogramBrushEvent(plot, drag, 'preview', event, 'select');
      }
      consumeNativeInteraction(event.originalEvent);
      return drag;
    }
    plot.commands.clearOverlays('lasso');
    if (event.type !== 'pointercancel' && drag.pixelPoints.length >= 3) {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      emitHistogramBrushEvent(plot, drag, 'commit', event, 'select');
      const selection = plot.commands.selectLasso({
        kind: drag.selectionKind,
        points: drag.pixelPoints,
        subplotId: drag.plotRect.id,
      });
      if ((selection === null || selection.selectedBinCount === 0) && drag.selectionKind === 'replace') {
        plot.commands.clearOverlays('committed-selection');
      }
    } else if (event.type !== 'pointercancel' && drag.selectionKind === 'replace') {
      plot.commands.clearSelection('replace');
    }
    if (event.type === 'pointercancel') {
      emitHistogramBrushEvent(plot, drag, 'cancel', event, 'select');
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  if (drag.kind === 'measurement') {
    if (event.type === 'pointermove') {
      consumeNativeInteraction(event.originalEvent);
      const hit = plot.commands.getBinAtPoint(event.host.x, event.host.y);
      plot.commands.setMeasurement({
        current: hit === null ? null : createHistogramMeasurementReference(hit),
        reference: createHistogramMeasurementReference(drag.reference)!,
      });
      plot.commands.setCursorState('default', 'pointer');
      return drag;
    }
    plot.commands.setMeasurement(null);
    if (event.type !== 'pointercancel' && event.modifiers.shiftKey) {
      plot.commands.hoverAtPoint({
        pointerCssX: event.host.x,
        pointerCssY: event.host.y,
        source: 'shift-hover',
      });
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  const moved =
    Math.hypot(event.host.x - drag.x, event.host.y - drag.y) > MIDDLE_CLICK_MAX_MOVE_CSS_PX;
  if (event.type === 'pointermove') {
    plot.commands.setCursorState('default', 'pointer');
    if (!moved) {
      return drag;
    }
    consumeNativeInteraction(event.originalEvent);
    const result = plot.commands.panFromDrag({
      axisMode: 'xy',
      currentPointerCssX: event.host.x,
      currentPointerCssY: event.host.y,
      startPointerCssX: drag.x,
      startPointerCssY: drag.y,
      startViewport: drag.startViewport,
      subplotId: drag.subplotId,
      updateCount: drag.updateCount + 1,
    });
    if (result !== null) {
      drag.updateCount += 1;
    }
    return drag;
  }
  if (event.type === 'pointerup') {
    consumeNativeInteraction(event.originalEvent);
    if (!moved && drag.updateCount === 0) {
      plot.commands.requestViewportUndo('pointer');
    } else if (drag.updateCount > 0) {
      plot.commands.setViewport(plot.commands.getStateSnapshot().viewport, 'drag', 'commit');
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }
  if (event.type === 'pointercancel') {
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }
  return drag;
}

function updateRectangleZoomOverlay(
  plot: HistogramPlotInstance,
  drag: RectangleZoomDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
): void {
  const feedback = createRectangleBrushRect(drag, currentPointerCssX, currentPointerCssY);
  if (feedback === null) {
    plot.commands.clearOverlays('rectangle-zoom');
    return;
  }
  plot.commands.setOverlays([
    {
      id: 'rectangle-zoom-preview',
      kind: 'rectangle-zoom',
      rect: feedback,
      subplotId: feedback.subplotId,
    },
  ]);
}

function updateRectangleSelectionOverlay(
  plot: HistogramPlotInstance,
  drag: RectangleSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
): void {
  plot.commands.setOverlays([
    {
      id: 'rectangle-selection-preview',
      kind: 'rectangle-selection',
      rect: cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY),
      subplotId: drag.plotRect.id,
    },
  ]);
}

function updateLassoOverlay(plot: HistogramPlotInstance, drag: LassoSelectionDrag): void {
  plot.commands.setOverlays([
    {
      id: 'lasso-preview',
      kind: 'lasso',
      points: drag.pixelPoints.map((point) => ({
        xCssPx: point.x,
        yCssPx: point.y,
      })),
      subplotId: drag.plotRect.id,
    },
  ]);
}

function cssRectFromDrag(
  drag: RectangleSelectionDrag | RectangleZoomDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
) {
  const xMin = Math.max(drag.plotRect.xCssPx, Math.min(drag.x, currentPointerCssX));
  const xMax = Math.min(
    drag.plotRect.xCssPx + drag.plotRect.widthCssPx,
    Math.max(drag.x, currentPointerCssX),
  );
  const yMin = Math.max(drag.plotRect.yCssPx, Math.min(drag.y, currentPointerCssY));
  const yMax = Math.min(
    drag.plotRect.yCssPx + drag.plotRect.heightCssPx,
    Math.max(drag.y, currentPointerCssY),
  );
  return {
    heightCssPx: Math.max(0, yMax - yMin),
    widthCssPx: Math.max(0, xMax - xMin),
    xCssPx: xMin,
    yCssPx: yMin,
  };
}

function emitHistogramBrushEvent(
  plot: HistogramPlotInstance,
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  phase: BrushPhase,
  event: NormalizedPointerEvent,
  defaultAction: HistogramBrushDefaultAction,
): void {
  plot.commands.emitBrushEvent(
    createHistogramBrushEvent(plot, drag, phase, event, defaultAction),
  );
}

function createHistogramBrushEvent(
  plot: HistogramPlotInstance,
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  phase: BrushPhase,
  event: NormalizedPointerEvent,
  defaultAction: HistogramBrushDefaultAction,
): HistogramBrushEvent {
  const parameterKey = resolveHistogramParameterKey(plot, drag.plotRect.id);
  return {
    cssGeometry: createHistogramBrushCssGeometry(drag, event.host.x, event.host.y),
    defaultAction,
    modifiers: snapshotBrushModifiers(event.modifiers),
    phase,
    range: createHistogramBrushRange(
      plot,
      drag,
      event.host.x,
      event.host.y,
      defaultAction,
    ),
    shape: drag.kind === 'lasso' ? 'lasso' : 'rectangle',
    source: 'pointer',
    target: {
      parameterKey,
      subplotId: drag.plotRect.id,
    },
  };
}

function createHistogramBrushCssGeometry(
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
): BrushCssGeometry {
  if (drag.kind === 'lasso') {
    return {
      points: drag.pixelPoints.map((point) => ({
        xCssPx: point.x,
        yCssPx: point.y,
      })),
      shape: 'lasso',
    };
  }
  return {
    rect:
      drag.kind === 'rectangle-zoom'
        ? createRectangleBrushRect(drag, currentPointerCssX, currentPointerCssY) ??
          cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY)
        : cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY),
    shape: 'rectangle',
  };
}

function createHistogramBrushRange(
  plot: HistogramPlotInstance,
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
  defaultAction: HistogramBrushDefaultAction,
): HistogramBrushRange | undefined {
  if (drag.kind === 'lasso') {
    const bounds = histogramPointBounds(drag.pixelPoints);
    if (bounds === null) {
      return undefined;
    }
    const range = histogramPixelBoundsToRange(plot, drag.plotRect, {
      maxX: bounds.x.max,
      maxY: bounds.y.max,
      minX: bounds.x.min,
      minY: bounds.y.min,
    });
    return addObservedHistogramBins(plot, drag, range, defaultAction, undefined);
  }
  const bounds = histogramRectangleDragBounds(drag, currentPointerCssX, currentPointerCssY);
  const range = histogramPixelBoundsToRange(plot, drag.plotRect, {
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    minX: bounds.minX,
    minY: bounds.minY,
  });
  return addObservedHistogramBins(plot, drag, range, defaultAction, bounds);
}

function histogramRectangleDragBounds(
  drag: RectangleSelectionDrag | RectangleZoomDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
) {
  const rect =
    drag.kind === 'rectangle-zoom'
      ? createRectangleBrushRect(drag, currentPointerCssX, currentPointerCssY) ??
        cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY)
      : cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY);
  return {
    maxX: rect.xCssPx + rect.widthCssPx,
    maxY: rect.yCssPx + rect.heightCssPx,
    minX: rect.xCssPx,
    minY: rect.yCssPx,
  };
}

function addObservedHistogramBins(
  plot: HistogramPlotInstance,
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  range: HistogramBrushRange | undefined,
  defaultAction: HistogramBrushDefaultAction,
  bounds:
    | {
        maxX: number;
        maxY: number;
        minX: number;
        minY: number;
      }
    | undefined,
): HistogramBrushRange | undefined {
  if (range === undefined || defaultAction !== 'none') {
    return range;
  }
  const query =
    drag.kind === 'lasso'
      ? plot.commands.queryBinsInLasso({
          points: drag.pixelPoints,
          subplotId: drag.plotRect.id,
        })
      : bounds === undefined
        ? null
        : plot.commands.queryBinsInRectangle({
            bounds,
            subplotId: drag.plotRect.id,
          });
  const bins = query?.binDescriptors ?? [];
  return {
    ...range,
    bins,
  };
}

function histogramPixelBoundsToRange(
  plot: HistogramPlotInstance,
  plotRect: HistogramPlotRect,
  bounds: { maxX: number; maxY: number; minX: number; minY: number },
): HistogramBrushRange | undefined {
  const subplotViewport = plot.commands.getStateSnapshot().viewport.subplotById[plotRect.id];
  if (subplotViewport === undefined) {
    return undefined;
  }
  const x = normalizeBrushNumericRange({
    max: histogramPixelToAxis(
      bounds.maxX,
      subplotViewport.x,
      plotRect.xCssPx,
      plotRect.xCssPx + plotRect.widthCssPx,
    ),
    min: histogramPixelToAxis(
      bounds.minX,
      subplotViewport.x,
      plotRect.xCssPx,
      plotRect.xCssPx + plotRect.widthCssPx,
    ),
  });
  const y = normalizeBrushNumericRange({
    max: histogramPixelToAxis(
      bounds.minY,
      subplotViewport.y,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    ),
    min: histogramPixelToAxis(
      bounds.maxY,
      subplotViewport.y,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    ),
  });
  return {
    value: x,
    x,
    y,
  };
}

function histogramPointBounds(
  points: readonly HistogramPoint[],
): { x: { max: number; min: number }; y: { max: number; min: number } } | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }
  return {
    x: { max: maxX, min: minX },
    y: { max: maxY, min: minY },
  };
}

function resolveHistogramParameterKey(
  plot: HistogramPlotInstance,
  subplotId: string,
): string {
  const subplot = plot.commands
    .getStateSnapshot()
    .aggregation.subplots.find((candidate) => candidate.subplotId === subplotId);
  return subplot?.parameterKey ?? subplotId;
}

function rectangleSelectionBounds(
  drag: RectangleSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
) {
  const rect = cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY);
  if (rect.widthCssPx < 4 || rect.heightCssPx < 4) {
    return null;
  }
  return {
    maxX: rect.xCssPx + rect.widthCssPx,
    maxY: rect.yCssPx + rect.heightCssPx,
    minX: rect.xCssPx,
    minY: rect.yCssPx,
  };
}

function shouldUseLasso(plot: HistogramPlotInstance): boolean {
  const snapshot = plot.commands.getStateSnapshot() as { readonly mode?: string };
  return snapshot.mode === 'lasso';
}

function handleKey(
  plot: HistogramPlotInstance,
  event: NormalizedKeyEvent,
  hoverScheduler?: ReturnType<typeof createLatestRafScheduler<NormalizedPointerEvent>>,
): void {
  if (event.type === 'keyup' && event.key === 'Shift') {
    clearTransientInspection(plot, hoverScheduler);
    return;
  }
  if (event.type !== 'keydown' || event.repeat || event.defaultPrevented) {
    return;
  }
  if (event.key.toLowerCase() === 'q' || event.code === 'KeyQ') {
    consumeNativeInteraction(event.originalEvent);
    plot.commands.requestViewportUndo('keyboard');
    return;
  }
  if (event.key === 'Escape' || event.code === 'Escape') {
    consumeNativeInteraction(event.originalEvent);
    plot.commands.clearOverlays('committed-selection');
    plot.commands.clearSelection();
  }
}

function isSpaceKey(event: NormalizedKeyEvent): boolean {
  return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
}

function isKeyboardSpaceKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
}

function isPointerOverPlot(
  plot: HistogramPlotInstance,
  event: NormalizedPointerEvent | null,
): boolean {
  return event !== null && plot.commands.getPlotRectAtPoint(event.host.x, event.host.y) !== null;
}

function shouldIgnoreSpaceShortcutTarget(target: EventTarget | null): boolean {
  let current: unknown = target;
  while (current !== null && typeof current === 'object') {
    const element = current as {
      readonly isContentEditable?: boolean;
      readonly parentElement?: unknown;
      readonly tagName?: string;
    };
    const tagName = element.tagName?.toLowerCase();
    if (
      element.isContentEditable === true ||
      tagName === 'input' ||
      tagName === 'select' ||
      tagName === 'textarea'
    ) {
      return true;
    }
    current = element.parentElement ?? null;
  }
  return false;
}

function clearTransientInspection(
  plot: HistogramPlotInstance,
  hoverScheduler?: ReturnType<typeof createLatestRafScheduler<NormalizedPointerEvent>>,
): void {
  hoverScheduler?.cancel();
  plot.commands.clearHover('binding');
  plot.commands.setMeasurement(null);
  plot.commands.setCursorState('default', 'binding');
}

function resolveWheelZoomAxisMode(
  event: Pick<NormalizedWheelEvent, 'modifiers'>,
): HistogramAxisMode | null {
  if (event.modifiers.ctrlKey) {
    return 'xy';
  }
  if (event.modifiers.shiftKey) {
    return 'y';
  }
  if (event.modifiers.altKey) {
    return 'x';
  }
  return null;
}

function isForcedXYRectangleZoomGesture(event: NormalizedPointerEvent): boolean {
  return (
    event.button === 0 &&
    event.modifiers.altKey &&
    event.modifiers.shiftKey &&
    !event.modifiers.ctrlKey &&
    !event.modifiers.metaKey
  );
}

function resolveWheelZoomDeltaY(
  event: Pick<NormalizedWheelEvent, 'deltaX' | 'deltaY' | 'modifiers'>,
  axisMode: HistogramAxisMode | null,
): number | null {
  if (Number.isFinite(event.deltaY) && event.deltaY !== 0) {
    return event.deltaY;
  }
  if (
    axisMode === 'y' &&
    event.modifiers.shiftKey &&
    Number.isFinite(event.deltaX) &&
    event.deltaX !== 0
  ) {
    return event.deltaX;
  }
  return null;
}

function resolveRectangleBrushGesture(
  event: NormalizedPointerEvent,
  gestures: readonly HistogramRectangleBrushGesture[] | undefined,
): HistogramRectangleBrushGesture | null {
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

function resolveRectangleBrushGestureAxisMode(
  gesture: HistogramRectangleBrushGesture,
): {
  axisMode: HistogramAxisMode;
  axisModeStrategy: HistogramRectangleZoomAxisModeStrategy;
} {
  if (gesture.axisMode === undefined || gesture.axisMode === 'auto') {
    return { axisMode: 'xy', axisModeStrategy: 'auto' };
  }
  return { axisMode: gesture.axisMode, axisModeStrategy: 'fixed' };
}

function createRectangleBrushRect(
  drag: RectangleZoomDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
) {
  return createHistogramRectangleZoomFeedback({
    axisMode: drag.axisMode,
    axisModeStrategy: drag.axisModeStrategy,
    currentPointerCssX,
    currentPointerCssY,
    plotRect: drag.plotRect,
    startPointerCssX: drag.x,
    startPointerCssY: drag.y,
  });
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

function withHeldShiftModifier(
  event: NormalizedPointerEvent,
  shiftHeld: boolean,
): NormalizedPointerEvent {
  if (!shiftHeld || event.modifiers.shiftKey) {
    return event;
  }
  return {
    ...event,
    modifiers: {
      ...event.modifiers,
      shiftKey: true,
    },
  };
}

function normalizeWindowKeyEvent(event: KeyboardEvent): NormalizedKeyEvent {
  return {
    code: event.code,
    defaultPrevented: event.defaultPrevented,
    key: event.key,
    modifiers: {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    },
    originalEvent: event,
    repeat: event.repeat,
    timeStamp: event.timeStamp,
    type: event.type === 'keyup' ? 'keyup' : 'keydown',
  };
}

function consumeNativeInteraction(event: Event | undefined): void {
  event?.preventDefault();
  event?.stopPropagation();
  event?.stopImmediatePropagation();
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
      // Some browser targets reject capture for synthetic or already-ended pointers.
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
