import { Route, Routes } from 'react-router-dom';
import { OverviewPage } from './routes/OverviewPage.tsx';
import { MParallelPlotRoute } from './routes/MParallelPlotRoute.tsx';
import { MParallelPackageFixture } from './routes/MParallelPackageFixture.tsx';
import { MScatterPackageFixture } from './routes/MScatterPackageFixture.tsx';
import { MScatterPlotRoute } from './routes/MScatterPlotRoute.tsx';
import { MHistogramPackageFixture } from './routes/MHistogramPackageFixture.tsx';
import { MHistogramPlotRoute } from './routes/MHistogramPlotRoute.tsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<OverviewPage />} />
      <Route path="/m-scatter" element={<MScatterPlotRoute />} />
      <Route path="/m-scatter-fixture" element={<MScatterPackageFixture />} />
      <Route
        path="/m-scatter-webgpu"
        element={<MScatterPlotRoute rendererBackend="webgpu" />}
      />
      <Route
        path="/m-scatter-webgpu-fixture"
        element={<MScatterPackageFixture rendererBackend="webgpu" />}
      />
      <Route path="/m-parallel" element={<MParallelPlotRoute />} />
      <Route path="/m-parallel-fixture" element={<MParallelPackageFixture />} />
      <Route
        path="/m-parallel-webgpu"
        element={<MParallelPlotRoute rendererBackend="webgpu" />}
      />
      <Route
        path="/m-parallel-webgpu-fixture"
        element={<MParallelPackageFixture rendererBackend="webgpu" />}
      />
      <Route path="/m-histogram" element={<MHistogramPlotRoute />} />
      <Route
        path="/m-histogram-webgpu"
        element={<MHistogramPlotRoute rendererBackend="webgpu" />}
      />
      <Route path="/m-histogram-fixture" element={<MHistogramPackageFixture />} />
      <Route
        path="/m-histogram-webgpu-fixture"
        element={<MHistogramPackageFixture rendererBackend="webgpu" />}
      />
    </Routes>
  );
}
