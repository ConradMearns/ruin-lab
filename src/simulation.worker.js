import { simulate } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const result = simulate(data.structure, data.settings, progress => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'complete', result });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
