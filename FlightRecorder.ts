import { TStateMachine } from './StateMachine';

type Recording = {
  count: number;
  time: number;
  current?: number;
  longest?: number;
};

const Recording = () => ({
  time: 0,
  count: 0,
  current: 0,
  longest: 0,
});

export type Records = { [key: string]: Recording };

const FlightRecorder = (...machines: TStateMachine<any>[]) => {
  const records: Records = {};

  machines.forEach(machine => {
    const states = Object.keys(machine.states);

    let currentStateName = '';
    let currentDuration = 0;

    states.forEach(state => {
      if (records[state]) {
        throw new Error(`Naming collision: state '${state}' exists in multiple state machines.`)
      }

      records[state] = Recording();

      machine.on(state, () => {
        const next = records[state];
        next.count++;
        currentStateName = state;
        currentDuration = 0;
      });
    });

    machine.on('tick', ({ delta }) => {
      const record = records[currentStateName];
      if (record) {
        record.time += delta;
        currentDuration += delta;

        if ((record.longest || 0) < currentDuration) {
          record.longest = currentDuration;
        }
      }
    });
  });

  return records;
};

export default FlightRecorder;
