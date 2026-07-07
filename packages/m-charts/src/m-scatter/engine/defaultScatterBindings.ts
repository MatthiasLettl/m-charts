import {
  addEventListenerDisposable,
  DisposableStack,
  createDomInputAdapter,
  createLatestRafScheduler,
  normalizeKeyEvent,
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
  createFastScatterRectangleZoomFeedback,
  createFastScatterMeasurementReferenceFromHover,
  pixelToAxis,
  type FastScatterAxisMode,
  type FastScatterEasterEggPlaybackOptions,
  type FastScatterPlotRect,
  type FastScatterRectangleZoomAxisModeStrategy,
  type FastScatterSelectionKind,
  type FastScatterSelectionPoint,
  type FastScatterViewport,
} from '../core/index.js';
import type { FastScatterBinding, FastScatterPlotInstance } from './types.js';
import type {
  FastScatterBrushDefaultAction,
  FastScatterBrushEvent,
  FastScatterBrushRange,
} from './scatterEvents.js';

export interface DefaultScatterBindingsOptions {
  easterEgg?: false | ScatterEasterEggBindingOptions;
  inputElement?: HTMLElement;
  rectangleBrushGestures?: readonly ScatterRectangleBrushGesture[];
  suppressContextMenu?: boolean;
}

export interface ScatterEasterEggBindingOptions extends FastScatterEasterEggPlaybackOptions {
  sequence?: string;
}

export interface ScatterRectangleBrushGesture {
  axisMode?: FastScatterAxisMode | 'auto';
  button: 0 | 2;
  defaultAction: Extract<FastScatterBrushDefaultAction, 'none' | 'zoom'>;
  modifiers?: Partial<InputModifiers>;
}

export function createDefaultScatterBindings(
  options: DefaultScatterBindingsOptions = {},
): FastScatterBinding {
  return {
    attach(plot: FastScatterPlotInstance) {
      const disposables = new DisposableStack();
      const inputTarget = options.inputElement ?? plot.hostElement.parentElement ?? plot.hostElement;
      const input = createDomInputAdapter(inputTarget, {
        coordinateTarget: plot.hostElement,
        suppressContextMenu: options.suppressContextMenu,
      });
      disposables.add(input);
      const easterEggHandledKeyEvents = new WeakSet<KeyboardEvent>();
      let pointerDrag: ScatterPointerDrag | null = null;
      let lastPointerEvent: NormalizedPointerEvent | null = null;
      let easterEggKeyBuffer = '';
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
      disposables.add(
        addEventListenerDisposable(inputTarget, 'dblclick', (event) => {
          if (pointerDrag !== null) {
            return;
          }
          handleDoubleClick(plot, event);
        }),
      );
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
          addEventListenerDisposable(
            globalThis.window,
            'pointercancel',
            handleWindowPointerEnd,
          ),
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
              const normalized = normalizePointerEvent(
                plot.hostElement,
                event,
                'pointermove',
              );
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
      }
      input.on('key', (event) => {
        if (isSpaceKey(event)) {
          spaceHeld =
            event.type === 'keydown' &&
            !shouldIgnoreSpaceShortcutTarget(event.originalEvent.target);
        }
        if (!easterEggHandledKeyEvents.has(event.originalEvent as KeyboardEvent)) {
          easterEggKeyBuffer = handleEasterEggKey(
            plot,
            event,
            easterEggKeyBuffer,
            options.easterEgg,
          );
        }
        handleKey(plot, event, hoverScheduler);
      });
      if (typeof globalThis.window !== 'undefined') {
        disposables.add(
          addEventListenerDisposable(
            globalThis.window,
            'keydown',
            (event) => {
              easterEggKeyBuffer = handleEasterEggKey(
                plot,
                normalizeKeyEvent(event),
                easterEggKeyBuffer,
                options.easterEgg,
              );
              easterEggHandledKeyEvents.add(event);
            },
            { capture: true },
          ),
        );
        disposables.add(
          addEventListenerDisposable(globalThis.window, 'keyup', (event) => {
            if (isKeyboardSpaceKey(event)) {
              spaceHeld = false;
            }
            if (event.key === 'Shift') {
              shiftHeld = false;
            }
            handleKey(plot, {
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
              type: 'keyup',
            }, hoverScheduler);
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
            if (!easterEggHandledKeyEvents.has(event)) {
              easterEggKeyBuffer = handleEasterEggKey(
                plot,
                normalizeKeyEvent(event),
                easterEggKeyBuffer,
                options.easterEgg,
              );
            }
          }),
        );
      }
      input.on('blur', () => {
        clearTransientInspection(plot, hoverScheduler);
      });

      return disposables;
    },
  };
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

	type ScatterPointerDrag =
  | PendingMiddleDrag
  | RectangleZoomDrag
  | RectangleSelectionDrag
  | LassoSelectionDrag
  | MeasurementDrag
  | NavigatorDrag;

interface PendingMiddleDrag {
  kind: 'middle';
  plotId: string;
  pointerId: number;
  startViewport: FastScatterViewport;
  updateCount: number;
  x: number;
  y: number;
}

interface RectangleZoomDrag {
  axisMode: FastScatterAxisMode;
  axisModeStrategy: FastScatterRectangleZoomAxisModeStrategy;
  defaultAction: Extract<FastScatterBrushDefaultAction, 'none' | 'zoom'>;
  kind: 'rectangle-zoom';
  modifiers: NormalizedPointerEvent['modifiers'];
  plotRect: FastScatterPlotRect;
  pointerId: number;
  startedAt: number;
  x: number;
  y: number;
}

interface RectangleSelectionDrag {
  kind: 'rectangle-selection';
  modifiers: NormalizedPointerEvent['modifiers'];
  plotRect: FastScatterPlotRect;
  pointerId: number;
  selectionKind: FastScatterSelectionKind;
  x: number;
  y: number;
}

interface LassoSelectionDrag {
  axisPoints: FastScatterSelectionPoint[];
  kind: 'lasso';
  modifiers: NormalizedPointerEvent['modifiers'];
  pixelPoints: { xCssPx: number; yCssPx: number }[];
  plotRect: FastScatterPlotRect;
  pointerId: number;
  selectionKind: FastScatterSelectionKind;
  yKey: string;
}

interface MeasurementDrag {
  kind: 'measurement';
  pointerId: number;
  reference: NonNullable<ReturnType<FastScatterPlotInstance['commands']['hoverAtPoint']>>;
  startedAt: number;
}

interface NavigatorDrag {
  edge: 'max' | 'min' | null;
  kind: 'navigator';
  pointerId: number;
  startPointerCssX: number;
  startWindow: FastScatterViewport['x'];
  updateCount: number;
  widthCssPx: number;
  xCssPx: number;
}

const MIDDLE_CLICK_MAX_MOVE_CSS_PX = 3;

function handleWheel(
  plot: FastScatterPlotInstance,
  event: NormalizedWheelEvent,
): void {
  const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
  if (plotRect === null) {
    return;
  }

  plot.commands.setActivePlot(plotRect.id, 'pointer');
  const axisMode = resolveWheelZoomAxisMode(event);
  const deltaY = resolveWheelZoomDeltaY(event, axisMode);

  if (axisMode === null) {
    if (deltaY === null) {
      return;
    }

    consumeNativeInteraction(event.originalEvent);
    if (plot.commands.getStateSnapshot().visualizationMode === 'heatmap') {
      plot.commands.requestHeatmapBinSizeAdjust({
        delta: deltaY < 0 ? -1 : 1,
        source: 'wheel',
      });
      return;
    }

    plot.commands.requestPointSizeAdjust({
      delta: deltaY < 0 ? 1 : -1,
      source: 'wheel',
    });
    return;
  }

  if (deltaY === null) {
    return;
  }

  consumeNativeInteraction(event.originalEvent);
  plot.commands.zoomAtPointer({
    axisMode,
    deltaMode: event.deltaMode,
    deltaX: event.deltaX,
    deltaY,
    pointerCssX: event.host.x,
    pointerCssY: event.host.y,
  });
}

function handlePointer(
  plot: FastScatterPlotInstance,
  event: NormalizedPointerEvent,
  pointerDrag: ScatterPointerDrag | null,
  lassoHeld: boolean,
  hoverScheduler?: ReturnType<typeof createLatestRafScheduler<NormalizedPointerEvent>>,
  options: Pick<DefaultScatterBindingsOptions, 'rectangleBrushGestures'> = {},
): ScatterPointerDrag | null {
  if (event.type === 'pointerdown' && !(event.button === 2 && event.modifiers.shiftKey)) {
    hoverScheduler?.cancel();
    if (plot.commands.getStateSnapshot().hoverSourceIndex !== null) {
      plot.commands.clearHover('pointer');
    }
  }

  if (event.type === 'pointerdown' && event.button === 2 && event.modifiers.shiftKey) {
    const hover = plot.commands.hoverAtPoint({
      pointerCssX: event.host.x,
      pointerCssY: event.host.y,
      source: 'measure',
    });
    if (hover === null) {
      return null;
    }
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    const reference = createFastScatterMeasurementReferenceFromHover(hover);
    plot.commands.setMeasurement({
      current: reference,
      reference,
    });
    plot.commands.setCursorState('default', 'pointer');
    return {
      kind: 'measurement',
      pointerId: event.pointerId,
      reference: hover,
      startedAt: performance.now(),
    };
  }

  if (event.type === 'pointerdown' && event.button === 0) {
    const navigatorDrag = startNavigatorDrag(plot, event);
    if (navigatorDrag !== null) {
      consumeNativeInteraction(event.originalEvent);
      capturePointer(event.originalEvent, event.pointerId);
      plot.commands.setCursorState('default', 'pointer');
      return navigatorDrag;
    }
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
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');
    plot.commands.setCursorState('crosshair', 'pointer');
    updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
    emitScatterBrushEvent(plot, drag, 'start', event, rectangleBrushGesture.defaultAction);
    return drag;
  }

  if (event.type === 'pointerdown' && event.button === 0 && !event.modifiers.shiftKey) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect === null) {
      return null;
    }
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
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');
    plot.commands.setCursorState('crosshair', 'pointer');
    updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
    emitScatterBrushEvent(plot, drag, 'start', event, 'zoom');
    return drag;
  }

  if (event.type === 'pointerdown' && isForcedXYRectangleZoomGesture(event)) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect === null) {
      return null;
    }
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
    consumeNativeInteraction(event.originalEvent);
    capturePointer(event.originalEvent, event.pointerId);
    plot.commands.setActivePlot(plotRect.id, 'pointer');
    plot.commands.setCursorState('crosshair', 'pointer');
    updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
    emitScatterBrushEvent(plot, drag, 'start', event, 'zoom');
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
    const selectionKind: FastScatterSelectionKind = event.modifiers.ctrlKey
      ? 'append'
      : 'replace';
    if (lassoHeld || plot.commands.getStateSnapshot().mode === 'lasso') {
      const axisPoint = pointCssToAxis(plot, plotRect, event.host.x, event.host.y);
      if (axisPoint === null) {
        return null;
      }
      const drag: LassoSelectionDrag = {
        axisPoints: [axisPoint],
        kind: 'lasso',
        modifiers: event.modifiers,
        pixelPoints: [{ xCssPx: event.host.x, yCssPx: event.host.y }],
        plotRect,
        pointerId: event.pointerId,
        selectionKind,
        yKey: plot.commands.getPlotYKey(plotRect.id) ?? plotRect.id,
      };
      updateLassoOverlay(plot, drag);
      emitScatterBrushEvent(plot, drag, 'start', event, 'select');
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
    emitScatterBrushEvent(plot, drag, 'start', event, 'select');
    return drag;
  }

  if (event.type === 'pointerdown' && event.button === 1 && !event.modifiers.shiftKey) {
    const plotRect = plot.commands.getPlotRectAtPoint(event.host.x, event.host.y);
    if (plotRect !== null) {
      consumeNativeInteraction(event.originalEvent);
      capturePointer(event.originalEvent, event.pointerId);
      plot.commands.setActivePlot(plotRect.id, 'pointer');
      plot.commands.setCursorState('default', 'pointer');
      return {
        kind: 'middle',
        plotId: plotRect.id,
        pointerId: event.pointerId,
        startViewport: plot.commands.getStateSnapshot().viewport,
        updateCount: 0,
        x: event.host.x,
        y: event.host.y,
      };
    }
    return null;
  }

  if (pointerDrag !== null && event.pointerId === pointerDrag.pointerId) {
    return updatePointerDrag(plot, event, pointerDrag);
  }

  if (event.type !== 'pointermove') {
    return pointerDrag;
  }

  if (event.modifiers.shiftKey) {
    plot.commands.setCursorState('default', 'pointer');
    hoverScheduler?.schedule(event);
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

function handleDoubleClick(plot: FastScatterPlotInstance, event: MouseEvent): void {
  if (
    event.button !== 0 ||
    (plot.commands.getStateSnapshot().visualizationMode ?? 'points') !== 'points'
  ) {
    return;
  }

  const normalized = normalizePointerEvent(plot.hostElement, event, 'pointermove');
  const plotRect = plot.commands.getPlotRectAtPoint(normalized.host.x, normalized.host.y);
  if (plotRect === null) {
    return;
  }

  const hover = plot.commands.hoverAtPoint({
    pointerCssX: normalized.host.x,
    pointerCssY: normalized.host.y,
    source: 'shift-hover',
  });
  if (hover === null || hover.aggregate !== undefined) {
    plot.commands.clearHover('binding');
    return;
  }

  consumeNativeInteraction(event);
  plot.commands.togglePointMarker({ sourceIndex: hover.point.sourceIndex });
  plot.commands.clearHover('binding');
}

function updatePointerDrag(
  plot: FastScatterPlotInstance,
  event: NormalizedPointerEvent,
  drag: ScatterPointerDrag,
): ScatterPointerDrag | null {
  if (drag.kind === 'rectangle-zoom') {
    if (event.type === 'pointermove') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      updateRectangleZoomOverlay(plot, drag, event.host.x, event.host.y);
      emitScatterBrushEvent(plot, drag, 'preview', event, drag.defaultAction);
      return drag;
    }

    plot.commands.clearOverlays('rectangle-zoom');
    if (event.type !== 'pointercancel') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      const brushEvent = createScatterBrushEvent(
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
            id: 'color-rule-brush',
            kind: 'color-rule-brush',
            plotId: drag.plotRect.id,
            rect: brushEvent.cssGeometry.rect,
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
      emitScatterBrushEvent(plot, drag, 'cancel', event, drag.defaultAction);
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  if (drag.kind === 'navigator') {
    if (event.type === 'pointermove') {
      consumeNativeInteraction(event.originalEvent);
      drag.updateCount += 1;
      plot.commands.dragNavigator({
        currentPointerCssX: event.host.x - drag.xCssPx,
        edge: drag.edge,
        startPointerCssX: drag.startPointerCssX,
        startWindow: drag.startWindow,
        updateCount: drag.updateCount,
        widthCssPx: drag.widthCssPx,
      });
      plot.commands.setCursorState('default', 'pointer');
      return drag;
    }
    if (event.type === 'pointerup' && drag.updateCount > 0) {
      consumeNativeInteraction(event.originalEvent);
      plot.commands.setViewport(plot.commands.getStateSnapshot().viewport, 'navigator', 'commit');
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  if (drag.kind === 'rectangle-selection') {
    if (event.type === 'pointermove') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      updateRectangleSelectionOverlay(plot, drag, event.host.x, event.host.y);
      emitScatterBrushEvent(plot, drag, 'preview', event, 'select');
      return drag;
    }
    plot.commands.clearOverlays('rectangle-selection');
    if (event.type !== 'pointercancel') {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      const bounds = rectangleSelectionBounds(plot, drag, event.host.x, event.host.y);
      if (bounds === null) {
        emitScatterBrushEvent(plot, drag, 'cancel', event, 'select');
        plot.commands.setCursorState('default', 'pointer');
        return null;
      }
      emitScatterBrushEvent(plot, drag, 'commit', event, 'select');
      const selection = plot.commands.selectRectangle({
        bounds,
        kind: drag.selectionKind,
        plotId: drag.plotRect.id,
      });
      if ((selection === null || selection.selectedCount === 0) && drag.selectionKind === 'replace') {
        plot.commands.clearOverlays('committed-selection');
      }
    } else {
      emitScatterBrushEvent(plot, drag, 'cancel', event, 'select');
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  if (drag.kind === 'lasso') {
    if (event.type === 'pointermove') {
      const last = drag.pixelPoints.at(-1);
      if (
        last === undefined ||
        Math.hypot(event.host.x - last.xCssPx, event.host.y - last.yCssPx) >= 2
      ) {
        const axisPoint = pointCssToAxis(plot, drag.plotRect, event.host.x, event.host.y);
        if (axisPoint !== null) {
          drag.pixelPoints.push({ xCssPx: event.host.x, yCssPx: event.host.y });
          drag.axisPoints.push(axisPoint);
          updateLassoOverlay(plot, drag);
          drag.modifiers = event.modifiers;
          emitScatterBrushEvent(plot, drag, 'preview', event, 'select');
        }
      }
      consumeNativeInteraction(event.originalEvent);
      return drag;
    }
    plot.commands.clearOverlays('lasso');
    if (event.type !== 'pointercancel' && drag.axisPoints.length >= 3) {
      consumeNativeInteraction(event.originalEvent);
      drag.modifiers = event.modifiers;
      emitScatterBrushEvent(plot, drag, 'commit', event, 'select');
      const selection = plot.commands.selectLasso({
        kind: drag.selectionKind,
        pixelPoints: drag.pixelPoints,
        plotId: drag.plotRect.id,
        points: drag.axisPoints,
        yKey: drag.yKey,
      });
      if ((selection === null || selection.selectedCount === 0) && drag.selectionKind === 'replace') {
        plot.commands.clearOverlays('committed-selection');
      }
    } else if (event.type !== 'pointercancel' && drag.selectionKind === 'replace') {
      plot.commands.clearSelection('replace');
    }
    if (event.type === 'pointercancel') {
      emitScatterBrushEvent(plot, drag, 'cancel', event, 'select');
    }
    plot.commands.setCursorState('default', 'pointer');
    return null;
  }

  if (drag.kind === 'measurement') {
    if (event.type === 'pointermove') {
      consumeNativeInteraction(event.originalEvent);
      const hover = plot.commands.hoverAtPoint({
        pointerCssX: event.host.x,
        pointerCssY: event.host.y,
        source: 'measure',
      });
      plot.commands.setMeasurement({
        current: hover === null ? null : createFastScatterMeasurementReferenceFromHover(hover),
        reference: createFastScatterMeasurementReferenceFromHover(drag.reference),
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
    Math.hypot(event.host.x - drag.x, event.host.y - drag.y) >
    MIDDLE_CLICK_MAX_MOVE_CSS_PX;

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
      plotId: drag.plotId,
      startPointerCssX: drag.x,
      startPointerCssY: drag.y,
      startViewport: drag.startViewport,
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

function startNavigatorDrag(
  plot: FastScatterPlotInstance,
  event: NormalizedPointerEvent,
): NavigatorDrag | null {
  const navigatorRect = plot.commands.getNavigatorRect();
  if (
    navigatorRect === null ||
    event.host.x < navigatorRect.xCssPx ||
    event.host.x > navigatorRect.xCssPx + navigatorRect.widthCssPx ||
    event.host.y < navigatorRect.yCssPx ||
    event.host.y > navigatorRect.yCssPx + navigatorRect.heightCssPx
  ) {
    return null;
  }

  const pointerCssX = event.host.x - navigatorRect.xCssPx;
  const windowPixels = plot.commands.getNavigatorWindowPixels(navigatorRect.widthCssPx);
  const windowLeft = windowPixels.leftCssPx;
  const windowRight = windowLeft + windowPixels.widthCssPx;
  const edgeHitSize = Math.max(8, Math.min(18, windowPixels.widthCssPx * 0.2));
  const leftDistance = Math.abs(pointerCssX - windowLeft);
  const rightDistance = Math.abs(pointerCssX - windowRight);
  const edge =
    leftDistance <= edgeHitSize || rightDistance <= edgeHitSize
      ? leftDistance < rightDistance
        ? 'min'
        : 'max'
      : null;

  return {
    edge,
    kind: 'navigator',
    pointerId: event.pointerId,
    startPointerCssX: pointerCssX,
    startWindow: plot.commands.getStateSnapshot().viewport.x,
    updateCount: 0,
    widthCssPx: navigatorRect.widthCssPx,
    xCssPx: navigatorRect.xCssPx,
  };
}

function cssRectFromDrag(
  drag: RectangleSelectionDrag | RectangleZoomDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
) {
  const xMin = Math.max(
    drag.plotRect.xCssPx,
    Math.min(drag.x, currentPointerCssX),
  );
  const xMax = Math.min(
    drag.plotRect.xCssPx + drag.plotRect.widthCssPx,
    Math.max(drag.x, currentPointerCssX),
  );
  const yMin = Math.max(
    drag.plotRect.yCssPx,
    Math.min(drag.y, currentPointerCssY),
  );
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

function emitScatterBrushEvent(
  plot: FastScatterPlotInstance,
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  phase: BrushPhase,
  event: NormalizedPointerEvent,
  defaultAction: FastScatterBrushDefaultAction,
): void {
  plot.commands.emitBrushEvent(
    createScatterBrushEvent(plot, drag, phase, event, defaultAction),
  );
}

function createScatterBrushEvent(
  plot: FastScatterPlotInstance,
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  phase: BrushPhase,
  event: NormalizedPointerEvent,
  defaultAction: FastScatterBrushDefaultAction,
): FastScatterBrushEvent {
  const yKey = plot.commands.getPlotYKey(drag.plotRect.id) ?? drag.plotRect.id;
  const xKey = plot.commands.getPlotXKey();
  const range = createScatterBrushRange(plot, drag, event.host.x, event.host.y);
  const axisMode = drag.kind === 'rectangle-zoom' ? drag.axisMode : 'xy';
  const parameterKey = axisMode === 'x' ? xKey ?? 'x' : yKey;
  return {
    cssGeometry: createScatterBrushCssGeometry(drag, event.host.x, event.host.y),
    defaultAction,
    modifiers: snapshotBrushModifiers(event.modifiers),
    phase,
    range,
    shape: drag.kind === 'lasso' ? 'lasso' : 'rectangle',
    source: 'pointer',
    target: {
      axisMode,
      parameterKey,
      plotId: drag.plotRect.id,
      xParameterKey: xKey ?? undefined,
      yKey,
    },
  };
}

function createScatterBrushCssGeometry(
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
): BrushCssGeometry {
  if (drag.kind === 'lasso') {
    return {
      points: drag.pixelPoints,
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

function createScatterBrushRange(
  plot: FastScatterPlotInstance,
  drag: RectangleZoomDrag | RectangleSelectionDrag | LassoSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
): FastScatterBrushRange | undefined {
  if (drag.kind === 'lasso') {
    const bounds = axisPointBounds(drag.axisPoints);
    if (bounds === null) {
      return undefined;
    }
    return {
      parameter: normalizeBrushNumericRange(bounds.y),
      x: normalizeBrushNumericRange(bounds.x),
      y: normalizeBrushNumericRange(bounds.y),
    };
  }

  const rect =
    drag.kind === 'rectangle-zoom'
      ? createRectangleBrushRect(drag, currentPointerCssX, currentPointerCssY) ??
        cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY)
      : cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY);
  const viewport = plot.commands.getStateSnapshot().viewport;
  const yRange = viewport.yByPlot[drag.plotRect.id];
  if (yRange === undefined) {
    return undefined;
  }
  const x = normalizeBrushNumericRange({
    max: pixelToAxis(
      rect.xCssPx + rect.widthCssPx,
      viewport.x,
      drag.plotRect.xCssPx,
      drag.plotRect.xCssPx + drag.plotRect.widthCssPx,
    ),
    min: pixelToAxis(
      rect.xCssPx,
      viewport.x,
      drag.plotRect.xCssPx,
      drag.plotRect.xCssPx + drag.plotRect.widthCssPx,
    ),
  });
  const y = normalizeBrushNumericRange({
    max: pixelToAxis(
      rect.yCssPx,
      yRange,
      drag.plotRect.yCssPx + drag.plotRect.heightCssPx,
      drag.plotRect.yCssPx,
    ),
    min: pixelToAxis(
      rect.yCssPx + rect.heightCssPx,
      yRange,
      drag.plotRect.yCssPx + drag.plotRect.heightCssPx,
      drag.plotRect.yCssPx,
    ),
  });
  return {
    parameter: drag.kind === 'rectangle-zoom' && drag.axisMode === 'x' ? x : y,
    x,
    y,
  };
}

function axisPointBounds(
  points: readonly FastScatterSelectionPoint[],
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

function rectangleSelectionBounds(
  plot: FastScatterPlotInstance,
  drag: RectangleSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
) {
  const rect = cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY);
  if (rect.widthCssPx < 4 || rect.heightCssPx < 4) {
    return null;
  }
  const viewport = plot.commands.getStateSnapshot().viewport;
  const yRange = viewport.yByPlot[drag.plotRect.id];
  if (yRange === undefined) {
    return null;
  }
  return {
    x: {
      max: pixelToAxis(
        rect.xCssPx + rect.widthCssPx,
        viewport.x,
        drag.plotRect.xCssPx,
        drag.plotRect.xCssPx + drag.plotRect.widthCssPx,
      ),
      min: pixelToAxis(
        rect.xCssPx,
        viewport.x,
        drag.plotRect.xCssPx,
        drag.plotRect.xCssPx + drag.plotRect.widthCssPx,
      ),
    },
    y: {
      max: pixelToAxis(
        rect.yCssPx,
        yRange,
        drag.plotRect.yCssPx + drag.plotRect.heightCssPx,
        drag.plotRect.yCssPx,
      ),
      min: pixelToAxis(
        rect.yCssPx + rect.heightCssPx,
        yRange,
        drag.plotRect.yCssPx + drag.plotRect.heightCssPx,
        drag.plotRect.yCssPx,
      ),
    },
    yKey: plot.commands.getPlotYKey(drag.plotRect.id) ?? drag.plotRect.id,
  };
}

function pointCssToAxis(
  plot: FastScatterPlotInstance,
  plotRect: FastScatterPlotRect,
  pointerCssX: number,
  pointerCssY: number,
): FastScatterSelectionPoint | null {
  const viewport = plot.commands.getStateSnapshot().viewport;
  const yRange = viewport.yByPlot[plotRect.id];
  if (yRange === undefined) {
    return null;
  }
  return {
    x: pixelToAxis(
      pointerCssX,
      viewport.x,
      plotRect.xCssPx,
      plotRect.xCssPx + plotRect.widthCssPx,
    ),
    y: pixelToAxis(
      pointerCssY,
      yRange,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    ),
  };
}

function updateRectangleSelectionOverlay(
  plot: FastScatterPlotInstance,
  drag: RectangleSelectionDrag,
  currentPointerCssX: number,
  currentPointerCssY: number,
): void {
  plot.commands.setOverlays([
    {
      id: 'rectangle-selection-preview',
      kind: 'rectangle-selection',
      plotId: drag.plotRect.id,
      rect: cssRectFromDrag(drag, currentPointerCssX, currentPointerCssY),
      selectionKind: drag.selectionKind,
    },
  ]);
}

function updateLassoOverlay(
  plot: FastScatterPlotInstance,
  drag: LassoSelectionDrag,
): void {
  plot.commands.setOverlays([
    {
      id: 'lasso-preview',
      kind: 'lasso',
      plotId: drag.plotRect.id,
      points: [...drag.pixelPoints],
      selectionKind: drag.selectionKind,
    },
  ]);
}

function updateRectangleZoomOverlay(
  plot: FastScatterPlotInstance,
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
      plotId: feedback.plotId,
      rect: feedback,
    },
  ]);
}

function handleKey(
  plot: FastScatterPlotInstance,
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
    plot.commands.clearSelection();
    plot.commands.clearPointMarkers();
  }
}

function handleEasterEggKey(
  plot: FastScatterPlotInstance,
  event: NormalizedKeyEvent,
  currentBuffer: string,
  options: DefaultScatterBindingsOptions['easterEgg'],
): string {
  if (
    options === undefined ||
    options === false ||
    event.type !== 'keydown' ||
    event.repeat ||
    event.defaultPrevented ||
    hasShortcutModifier(event) ||
    shouldIgnoreSpaceShortcutTarget(event.originalEvent.target)
  ) {
    return currentBuffer;
  }

  const sequence = normalizeEasterEggSequence(
    typeof options === 'object' ? options.sequence : undefined,
  );
  const key = normalizeEasterEggKey(event);
  if (key === null) {
    return currentBuffer;
  }

  const nextBuffer = (currentBuffer + key).slice(-sequence.length);
  if (nextBuffer.length > 0 && sequence.startsWith(nextBuffer)) {
    consumeNativeInteraction(event.originalEvent);
  }
  if (nextBuffer !== sequence) {
    return nextBuffer;
  }

  const playbackOptions =
    typeof options === 'object'
      ? {
          color: options.color,
          enterDurationMs: options.enterDurationMs,
          exitDurationMs: options.exitDurationMs,
          holdDurationMs: options.holdDurationMs,
          pointSizePx: options.pointSizePx,
          staggerMs: options.staggerMs,
          word: options.word,
        }
      : undefined;
  if (plot.commands.playEasterEgg(playbackOptions)) {
    consumeNativeInteraction(event.originalEvent);
  }
  return '';
}

function normalizeEasterEggSequence(sequence: string | undefined): string {
  const normalized = (sequence ?? 'future').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length === 0 ? 'future' : normalized;
}

function normalizeEasterEggKey(event: NormalizedKeyEvent): string | null {
  if (event.key.length === 1 && /^[a-z0-9]$/i.test(event.key)) {
    return event.key.toLowerCase();
  }
  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(3).toLowerCase();
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice(5);
  }
  return null;
}

function hasShortcutModifier(event: NormalizedKeyEvent): boolean {
  return event.modifiers.altKey || event.modifiers.ctrlKey || event.modifiers.metaKey;
}

function isSpaceKey(event: NormalizedKeyEvent): boolean {
  return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
}

function isKeyboardSpaceKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
}

function isPointerOverPlot(
  plot: FastScatterPlotInstance,
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
  plot: FastScatterPlotInstance,
  hoverScheduler?: ReturnType<typeof createLatestRafScheduler<NormalizedPointerEvent>>,
): void {
  hoverScheduler?.cancel();
  plot.commands.clearHover('binding');
  plot.commands.setMeasurement(null);
  plot.commands.setCursorState('default', 'binding');
}

function resolveWheelZoomAxisMode(
  event: Pick<NormalizedWheelEvent, 'modifiers'>,
): FastScatterAxisMode | null {
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
  axisMode: FastScatterAxisMode | null,
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
  gestures: readonly ScatterRectangleBrushGesture[] | undefined,
): ScatterRectangleBrushGesture | null {
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
  gesture: ScatterRectangleBrushGesture,
): {
  axisMode: FastScatterAxisMode;
  axisModeStrategy: FastScatterRectangleZoomAxisModeStrategy;
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
  return createFastScatterRectangleZoomFeedback({
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
