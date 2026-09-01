import type { FastScatterCssPoint } from './scatterOverlays.js';

export interface FastScatterReferenceLineStyle {
  color?: string;
  dash?: readonly number[];
  opacity?: number;
  widthCssPx?: number;
}

/**
 * An application-owned vertical annotation in the scatter plot's encoded X
 * coordinate space. Datetime, categorical, boolean, and numeric axes all use
 * the same finite numeric coordinate system exposed by the plotted X column.
 */
export interface FastScatterReferenceLine {
  axis: 'x';
  draggable?: boolean;
  id: string;
  label?: string;
  plotIds?: readonly string[];
  style?: FastScatterReferenceLineStyle;
  value: number;
}

export type FastScatterReferenceLineChangePhase =
  | 'cancel'
  | 'commit'
  | 'preview'
  | 'start';

export type FastScatterReferenceLineChangeSource = 'pointer' | 'programmatic';

export interface FastScatterReferenceLineChangeEvent {
  formattedValue: string;
  id: string;
  line: FastScatterReferenceLine;
  phase: FastScatterReferenceLineChangePhase;
  previousValue: number;
  source: FastScatterReferenceLineChangeSource;
  value: number;
}

export interface FastScatterReferenceLineCreateRequestEvent {
  axis: 'x';
  canvasPoint: FastScatterCssPoint;
  formattedValue: string;
  plotId: string;
  source: 'pointer' | 'programmatic';
  value: number;
  xKey: string | null;
}

export interface FastScatterReferenceLineHoverEvent {
  canvasPoint: FastScatterCssPoint;
  detailsVisible: boolean;
  formattedValue: string;
  id: string;
  line: FastScatterReferenceLine;
  plotId: string;
  value: number;
}

export interface FastScatterReferenceLineHit {
  distanceCssPx: number;
  formattedValue: string;
  id: string;
  line: FastScatterReferenceLine;
  plotId: string;
  value: number;
  xCssPx: number;
}
