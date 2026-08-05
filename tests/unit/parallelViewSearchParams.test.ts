import assert from 'node:assert/strict';

import {
  parseParallelAxisViewportsSearchParams,
  serializeParallelAxisViewportsSearchParams,
} from '../../apps/demo/src/state/parallelViewSearchParams.ts';

const axisOrder = ['signalValue', 'phase'] as const;
const domainsByAxis = {
  phase: { max: 3, min: 0, span: 3 },
  signalValue: { max: 100, min: 20, span: 80 },
};

const serialized = serializeParallelAxisViewportsSearchParams(
  {
    phase: { max: 2.5, min: 0.5 },
    signalValue: { max: 70, min: 40 },
  },
  axisOrder,
  new URLSearchParams('theme=dark&pf.stale.min=1&pf.stale.max=2'),
);

assert.equal(serialized.get('theme'), 'dark');
assert.equal(serialized.has('pf.stale.min'), false);
assert.equal(serialized.get('pf.signalValue.min'), '40');
assert.equal(serialized.get('pf.signalValue.max'), '70');
assert.deepEqual(
  parseParallelAxisViewportsSearchParams(serialized, axisOrder, domainsByAxis),
  {
    phase: { max: 2.5, min: 0.5 },
    signalValue: { max: 70, min: 40 },
  },
);

assert.deepEqual(
  parseParallelAxisViewportsSearchParams(
    new URLSearchParams(
      'pf.signalValue.min=0&pf.signalValue.max=80&pf.phase.min=nope&pf.phase.max=2',
    ),
    axisOrder,
    domainsByAxis,
  ),
  { signalValue: { max: 80, min: 20 } },
);

assert.deepEqual(
  parseParallelAxisViewportsSearchParams(
    new URLSearchParams(
      'pf.signalValue.min=20&pf.signalValue.max=100&pf.phase.min=2&pf.phase.max=1',
    ),
    axisOrder,
    domainsByAxis,
  ),
  {},
);

console.log('parallel viewport search param tests passed');
