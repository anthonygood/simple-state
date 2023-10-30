import { StateMachine } from './StateMachine';
import FlightRecorder from './FlightRecorder';

const getStateMachine = () => StateMachine<any>('idle')
  .transitionTo('walking').when(data => data.walk)
  .transitionTo('jumping').when(data => data.jump)
  .state('walking')
  .transitionTo('jumping').when(data => data.jump)
  // Can only transition to idle from jumping
  .state('jumping')
  .transitionTo('idle').when(data => data.idle);

const ticks = [
  /*|  state  |    change     |
    |=========================| */
      'none', // idle 1       |
      'none', //   idling +10 |
      'walk', // walk 1       |
      'walk', //   walking +10|
      'walk', //   walking +20|
      'walk', //   walking +30|
      'walk', //   walking +40|
      'jump', // jump 1       |
      'walk', //   jumping +10 (invalid transition, shouldn't count)
      'idle', // idle 2       |
      'idle', //   idling +20 |
      'jump', // jump 2       |
      'jump', //   jumping +20|
      'idle', // idle 3       |
      'walk', // walk 2       |
    ];

describe('FlightRecorder', () => {
  const machine = getStateMachine();
  const recorder = FlightRecorder(machine);

  machine.init();
  ticks.forEach(key => {
    machine.process({ [key]: true, delta: 10 })
  });

  it('records state counts', () => {
    expect(recorder.idle.count).toBe(3);
    expect(recorder.walking.count).toBe(2);
    expect(recorder.jumping.count).toBe(2);
  });

  it('records state times', () => {
    expect(recorder.idle.time).toBe(30);
    expect(recorder.walking.time).toBe(40);
    expect(recorder.jumping.time).toBe(20);
  });

  it('records longest times', () => {
    expect(recorder.idle.longest).toBe(20);
    expect(recorder.walking.longest).toBe(40);
    expect(recorder.jumping.longest).toBe(10);
  });

  it('can record multiple state machines', () => {
    const a = getStateMachine();
    const b = StateMachine<any>('right')
      .transitionTo('left').when(data => data.left)
      .state('left').transitionTo('right').when(data => data.right);

    const bTicks = [
    /*|  state  |    change     |
      |=========================| */
        'none', //   right +11  |
        'none', //   right +11  |
        'left', // left 1       |
        'right',// right 2      |
        'none', //   right +11  |
        'none', //   right +11  |
        'left', // left 2       |
        'right',// right 3      |
        'none', //   right +11  |
        'left', // left 3       |
        'none', //   left +11   |
        'right', // right 4     |
        'none', //   right +11  |
        'none', //   right +11  |
        'none', //   right +11  |
      ];

      const recorder = FlightRecorder(a, b);
      a.init();
      b.init();

      ticks.forEach(key => {
        a.process({ [key]: true, delta: 11 });
      });
      bTicks.forEach(key => {
        b.process({ [key]: true, delta: 11 });
      });

      expect(recorder.idle.count).toBe(3);
      expect(recorder.walking.count).toBe(2);
      expect(recorder.jumping.count).toBe(2);
      expect(recorder.left.count).toBe(3);
      expect(recorder.right.count).toBe(4);

      expect(recorder.idle.time).toBe(33);
      expect(recorder.walking.time).toBe(44);
      expect(recorder.jumping.time).toBe(22);
      expect(recorder.left.time).toBe(11);
      expect(recorder.right.time).toBe(88);

      expect(recorder.idle.longest).toBe(22);
      expect(recorder.walking.longest).toBe(44);
      expect(recorder.jumping.longest).toBe(11);
      expect(recorder.left.longest).toBe(11);
      expect(recorder.right.longest).toBe(33);
  });

  it('throws if there\'s a naming collision (two states with same name)', () => {
    expect(() => {
      FlightRecorder(getStateMachine(), getStateMachine())
    }).toThrow(`Naming collision: state 'idle' exists in multiple state machines.`);
  });
});
