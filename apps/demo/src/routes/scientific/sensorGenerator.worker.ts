import { createSensorReadings } from './sensorModel.ts';
self.onmessage = ({ data }: MessageEvent<number>) => {
  try {
    self.postMessage({ readings: createSensorReadings(data / 3) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
