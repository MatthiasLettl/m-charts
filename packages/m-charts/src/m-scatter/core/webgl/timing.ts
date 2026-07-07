export interface FastScatterGpuTimer {
  readonly supported: boolean;
  begin(): void;
  end(): void;
  poll(): FastScatterGpuTimingResult | null;
}

export interface FastScatterGpuTimingResult {
  durationMs: number;
  disjoint: boolean;
}

interface TimerQueryExtension {
  GPU_DISJOINT_EXT: number;
  TIME_ELAPSED_EXT: number;
}

export function createFastScatterGpuTimer(
  gl: WebGL2RenderingContext,
): FastScatterGpuTimer {
  const extension = gl.getExtension(
    'EXT_disjoint_timer_query_webgl2',
  ) as TimerQueryExtension | null;

  if (extension === null || typeof gl.createQuery !== 'function') {
    return createNoopGpuTimer();
  }

  let activeQuery: WebGLQuery | null = null;
  let pendingQuery: WebGLQuery | null = null;

  return {
    supported: true,
    begin() {
      if (activeQuery !== null || pendingQuery !== null || gl.isContextLost()) {
        return;
      }

      const query = gl.createQuery();
      if (query === null) {
        return;
      }

      activeQuery = query;
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    },
    end() {
      if (activeQuery === null || gl.isContextLost()) {
        return;
      }

      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pendingQuery = activeQuery;
      activeQuery = null;
    },
    poll() {
      if (pendingQuery === null || gl.isContextLost()) {
        return null;
      }

      const available = gl.getQueryParameter(
        pendingQuery,
        gl.QUERY_RESULT_AVAILABLE,
      ) as boolean;
      const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));

      if (!available && !disjoint) {
        return null;
      }

      const elapsedNs = disjoint
        ? 0
        : (gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT) as number);
      gl.deleteQuery(pendingQuery);
      pendingQuery = null;

      return {
        disjoint,
        durationMs: elapsedNs / 1_000_000,
      };
    },
  };
}

function createNoopGpuTimer(): FastScatterGpuTimer {
  return {
    supported: false,
    begin() {},
    end() {},
    poll() {
      return null;
    },
  };
}
