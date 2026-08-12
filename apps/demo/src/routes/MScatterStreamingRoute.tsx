import { Navigate, useLocation } from 'react-router-dom';

export function MScatterStreamingRoute() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  if (!searchParams.has('webgpuData')) {
    searchParams.set('webgpuData', 'stream-local');
  }
  return (
    <Navigate
      replace
      to={{
        pathname: '/m-scatter-webgpu',
        search: `?${searchParams.toString()}`,
      }}
    />
  );
}
