import { describe, expect, jest, it } from '@jest/globals';

import { StateMachine } from './StateMachine';

describe('StateMachine', () => {
  it('returns a state machine that follows set of rules', () => {
    const machine = StateMachine<any>('idle')
      .transitionTo('walk').when(data => data.key === '<walk>');

    expect(machine.currentState()).toBe('idle');
    machine.process({})
    expect(machine.currentState()).toBe('idle');
    machine.process({ key: '<walk>' });
    expect(machine.currentState()).toBe('walk');
  });

  it('throws with invalid transition to same state', () => {
    expect(() => {
      StateMachine('foo').transitionTo('foo')
    }).toThrow('Cannot transition to same state: \'foo\'');
  });

  it('works with more complex example', () => {
    const machine = StateMachine<any>('idle')
      .transitionTo('walk').when(data => data.key === '<walk>').or(data => data.foo);

    expect(machine.currentState()).toBe('idle');
    machine.process({})
    expect(machine.currentState()).toBe('idle');
    machine.process({ foo: true });
    expect(machine.currentState()).toBe('walk');
    machine.process({ key: '<walk>' });
    expect(machine.currentState()).toBe('walk');

    machine.state('walk').transitionTo('idle').when(data => data.action === '<finished>');
    machine.process({ action: '<finished>' });

    expect(machine.currentState()).toBe('idle');
  });

  it('works with yet more complex state graph example', () => {
    const machine = StateMachine<any>('idle')
      .transitionTo('walking').when(data => data.walk || data.key === '<walk>')
      .state('walking')
      .transitionTo('jumping').when(data => data.jump).or(data => data.jump === '<jump>')
      // Can only transition to idle from jumping
      .state('jumping')
      .transitionTo('idle').when(data => data.idle).or(data => data.key === '<idle>');

    expect(machine.currentState()).toBe('idle');

    machine.process({ walk: true });
    expect(machine.currentState()).toBe('walking');

    machine.process({ key: '<idle>' });
    expect(machine.currentState()).toBe('walking');

    machine.process({ jump: true })
    expect(machine.currentState()).toBe('jumping');

    // Can't transition to walking from jumping
    machine.process({ key: '<walk>' })
    expect(machine.currentState()).toBe('jumping');

    machine.process({ key: '<idle>' });
    expect(machine.currentState()).toBe('idle');
  });

  describe('initialising new state', () => {
    it('calls function when transitionining to new state', () => {
      const mock = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk).andThen(mock);

      expect(mock).not.toHaveBeenCalled();

      machine.process({ walk: true })

      expect(mock).toHaveBeenCalled();
    });

    it('also works with the inverse construction', () => {
      const mock = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').andThen(mock).when(data => data.walk);

      expect(mock).not.toHaveBeenCalled();

      machine.process({ walk: true })

      expect(mock).toHaveBeenCalled();
    });

    it('initialises default state if needed', () => {
      const init1 = jest.fn();
      const init2 = jest.fn();
      const machine = StateMachine<any>('idle').andThen(init1)
        .transitionTo('walk').andThen(init2).when(data => data.walk);

      expect(init1).not.toHaveBeenCalled()

      machine.init({});
      expect(init1).toHaveBeenCalled()

      expect(init2).not.toHaveBeenCalled();
      machine.process({ walk: true })
      expect(init2).toHaveBeenCalled();
    });
  });

  describe('previousState()', () => {
    it('exposes the previous state the machine was in (NOT the previous tick)', () => {
      const machine = StateMachine<any, 'idle' | 'walk'>('idle')
        .transitionTo('walk').when(data => data.key === '<walk>');

      expect(machine.previousState()).toBe(null);
      machine.process({})
      expect(machine.previousState()).toBe(null);
      machine.process({ key: '<walk>' });
      expect(machine.previousState()).toBe('idle');
    });
  });

  describe('tick state', () => {
    it('calls tick function for each process() call where state does not change', () => {
      const tick1 = jest.fn();
      const tick2 = jest.fn();

      const machine = StateMachine<any>('idle').tick(tick1)
        .transitionTo('walk').when(data => data.walk)
        .state('walk').tick(tick2);

      expect(tick1).not.toHaveBeenCalled();
      expect(tick2).not.toHaveBeenCalled();

      machine.process({ walk: false });
      machine.process({ walk: false });

      expect(tick1).toHaveBeenCalledTimes(2);
      expect(tick2).not.toHaveBeenCalled();

      machine.process({ walk: true });

      expect(tick1).toHaveBeenCalledTimes(2);
      expect(tick2).not.toHaveBeenCalled();

      machine.process({});

      expect(tick1).toHaveBeenCalledTimes(2);
      expect(tick2).toHaveBeenCalledTimes(1);
    });
  });

  describe('chaining state transitions', () => {
    it('can use .state() to declare different transitions', () => {
      const idleInit = jest.fn();
      const walkInit = jest.fn();
      const walkTick = jest.fn();
      const neverCall = jest.fn();
      const machine = StateMachine<any>('idle').andThen(idleInit)
        .transitionTo('walk').when(data => data.walk)
        .transitionTo('never').when(() => false) // Never transition
        .state('walk').andThen(walkInit).tick(walkTick)
        .transitionTo('idle').when(data => !data.walk)
        .state('never').andThen(neverCall)
        .init({});

      expect(machine.currentState()).toBe('idle');

      machine.process({ walk: true });
      expect(machine.currentState()).toBe('walk');
      expect(idleInit).toHaveBeenCalledTimes(1);
      expect(walkInit).toHaveBeenCalledTimes(1);
      expect(walkTick).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(machine.currentState()).toBe('walk');
      expect(idleInit).toHaveBeenCalledTimes(1);
      expect(walkInit).toHaveBeenCalledTimes(1);
      expect(walkTick).toHaveBeenCalledTimes(1);
      expect(neverCall).not.toHaveBeenCalled();

      machine.process({ walk: false });
      expect(machine.currentState()).toBe('idle');
      expect(idleInit).toHaveBeenCalledTimes(2);
      expect(walkInit).toHaveBeenCalledTimes(1);
      expect(walkTick).toHaveBeenCalledTimes(1);
      expect(neverCall).not.toHaveBeenCalled();
    });

    it('throws if you declare invalid transition', () => {
      expect(() => {
        StateMachine<any>('idle')
          .transitionTo('walk')
          .state('walk').when(data => data.walk).andThen(jest.fn());
      }).toThrow("Cannot transition to same state: 'walk'");
    });

    describe('forAtLeast', () => {
      it('can declare minTicks for transition state', () => {
        const idleInit = jest.fn();
        const walkInit = jest.fn();
        const walkTick = jest.fn();

        // No idle tick callback, so should no-op for two ticks
        const machine = StateMachine<any>('idle').andThen(idleInit).forAtLeast(2)
          .transitionTo('walk').when(data => data.walk).or(data => data.run)
          // Expect walkTick to be called for 4 ticks
          .andThen(walkInit).tick(walkTick).forAtLeast(4)
          .state('walk').transitionTo('idle').when(data => !data.walk)
          .init({});

        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(machine.currentState()).toBe('idle');

        // First tick
        machine.process({ walk: true })
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(0);

        // Second tick
        machine.process({ walk: true })
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(0);

        // Third tick
        machine.process({ walk: true })
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(0);

        // Fourth tick - conditions met to return to idle, but should tick at least 4 times
        machine.process({ walk: false })
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(1);

        // Fifth tick
        machine.process({ walk: false })
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(2);

        // Sixth tick
        machine.process({ walk: false })
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(3);

        // Seventh tick
        machine.process({ walk: false })
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(4);

        // Seventh tick
        machine.process({ walk: false })
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(2);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(4);

        // Eighth tick - and checking minTicks for transition back again...
        machine.process({ walk: true })
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(2);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(4);

        // Ninth tick
        machine.process({ walk: true })
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(2);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(4);

        // Ninth tick
        machine.process({ walk: true })
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(2);
        expect(walkInit).toHaveBeenCalledTimes(2);
        expect(walkTick).toHaveBeenCalledTimes(4);
      });

      it('can declare minDuration for transition state by calling forAtLeast(n, "duration")', () => {
        const idleInit = jest.fn();
        const walkInit = jest.fn();
        const walkTick = jest.fn();

        // No idle tick callback, so should no-op for two duration
        const machine = StateMachine<any>('idle').andThen(idleInit).forAtLeast(15, 'duration')
          .transitionTo('walk').when(data => data.walk).or(data => data.run)
          // Expect walkTick to be called for minimum 40 duration
          .andThen(walkInit).tick(walkTick).forAtLeast(40, 'duration')
          .state('walk').transitionTo('idle').when(data => !data.walk)
          .init({ dt: 0 });

        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(machine.currentState()).toBe('idle');

        // First tick, cumulative duration is 1
        machine.process({ walk: true, dt: 1 });
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(0);

        // Second tick, cumulative duration is 5
        machine.process({ walk: true, dt: 4 });
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(0);

        // Third tick, cumulative duration of new state is 15
        machine.process({ walk: true, dt: 10 });
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(0);

        // Fourth tick, new cumulative duration is 10
        machine.process({ walk: false, dt: 10 });
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(1);

        // Fifth tick, cumulative duration is 15
        machine.process({ walk: false, dt: 5 });
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(2);

        // Sixth tick, cumulative duration is 21
        machine.process({ walk: false, dt: 6 });
        expect(machine.currentState()).toBe('walk');
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(3);

        // Seventh tick, cumulative duration is 42
        machine.process({ walk: false, dt: 21 });
        expect(machine.currentState()).toBe('idle');
        expect(idleInit).toHaveBeenCalledTimes(2);
        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(3);
      });

      it('accepts function to define minTicks for transition state', () => {
        const idleInit = jest.fn();
        const idleTick = jest.fn();
        const walkInit = jest.fn();
        const walkTick = jest.fn();

        // forAtLeast value increases with each call
        let calls = 0;
        const forAtLeastFn = () => ++calls;

        // Should call idleTick once
        const machine = StateMachine<any>('idle').andThen(idleInit).tick(idleTick).forAtLeast(forAtLeastFn)
          .transitionTo('walk').when(data => data.walk)
          // Should call walkTick twice
          .andThen(walkInit).tick(walkTick).forAtLeast(forAtLeastFn)
          .state('walk').transitionTo('idle').when(data => !data.walk)
          .init({});

        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(idleTick).toHaveBeenCalledTimes(0);

        expect(walkInit).toHaveBeenCalledTimes(0);
        expect(walkTick).toHaveBeenCalledTimes(0);

        // Doesn't walk yet, because must tick forAtLeast 1
        machine.process({ walk: true });
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(idleTick).toHaveBeenCalledTimes(1);

        expect(walkInit).toHaveBeenCalledTimes(0);
        expect(walkTick).toHaveBeenCalledTimes(0);

        // Now walks, because idle ticked once
        machine.process({ walk: true });
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(idleTick).toHaveBeenCalledTimes(1);

        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(0);

        // Doesn't idle yet, because must tick forAtLeast 2
        machine.process({ walk: false });
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(idleTick).toHaveBeenCalledTimes(1);

        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(1);

        // Doesn't idle yet, because must tick forAtLeast 2
        machine.process({ walk: false });
        expect(idleInit).toHaveBeenCalledTimes(1);
        expect(idleTick).toHaveBeenCalledTimes(1);

        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(2);

        // Idles again
        machine.process({ walk: false });
        expect(idleInit).toHaveBeenCalledTimes(2);
        expect(idleTick).toHaveBeenCalledTimes(1);

        expect(walkInit).toHaveBeenCalledTimes(1);
        expect(walkTick).toHaveBeenCalledTimes(2);

        // Should idle for 3 ticks...
        machine.process({ walk: true });
        machine.process({ walk: true });
        machine.process({ walk: true });

        // ...and then walk
        machine.process({ walk: true });

        expect(idleInit).toHaveBeenCalledTimes(2);
        expect(idleTick).toHaveBeenCalledTimes(4);

        expect(walkInit).toHaveBeenCalledTimes(2);
        expect(walkTick).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('events', () => {
    it('can subscribe to state machine events', () => {
      const onWalk = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .on('walk', onWalk);

      expect(onWalk).not.toHaveBeenCalled();

      machine.process({});
      expect(onWalk).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalled();
    });

    it('can subscribe to specific state changes by passing metadata', () => {
      const onWalkFromRun = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('run').when(data => data.run)
        .state('run').transitionTo('walk').when(data => data.walk)
        .transitionTo('idle').when(data => !data.walk && !data.run);

      machine.on({ from: 'run', to: 'walk' }, onWalkFromRun);

      expect(onWalkFromRun).not.toHaveBeenCalled();

      machine.process({});
      expect(onWalkFromRun).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onWalkFromRun).not.toHaveBeenCalled();

      machine.process({ run: true });
      expect(onWalkFromRun).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onWalkFromRun).toHaveBeenCalled();
    });

    it('calls subscriber with data and metadata', () => {
      const onWalk = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .on('walk', onWalk);

      machine.process({ walk: true, foo: 'bar' });
      expect(onWalk).toHaveBeenCalledWith({ walk: true, foo: 'bar' }, { from: 'idle', to: 'walk', tickCount: 0, duration: null });
    });

    it('correctly calls subscribers for multiple state changes', () => {
      const onWalk = jest.fn();
      const onWalk2 = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('idle').when(data => !data.walk)
        .on('walk', onWalk)
        .on('walk', onWalk2);

      machine.process({});
      expect(onWalk).not.toHaveBeenCalled();
      expect(onWalk2).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(1);
      expect(onWalk2).toHaveBeenCalledTimes(1);

      // Don't call again on tick
      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(1);
      expect(onWalk2).toHaveBeenCalledTimes(1);

      // Don't call again on transition to other state
      machine.process({ walk: false });
      expect(onWalk).toHaveBeenCalledTimes(1);
      expect(onWalk2).toHaveBeenCalledTimes(1);

      // Call again on second transition to walk state
      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(2);
      expect(onWalk2).toHaveBeenCalledTimes(2);
    });

    it('can subscribe to every tick of a particular state', () => {
      const onWalk = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .onEvery('walk', onWalk);

      expect(onWalk).not.toHaveBeenCalled();

      machine.process({});
      expect(onWalk).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(1);
      expect(onWalk).toHaveBeenCalledWith({ walk: true }, { from: 'idle', to: 'walk', tickCount: 0, duration: null });

      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(2);
      expect(onWalk).toHaveBeenCalledWith({ walk: true }, { from: 'walk', to: 'walk', tickCount: 1, duration: null });
    });

    it('has correct currentState when callback is invoked', () => {
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk);

      let currentState = machine.currentState();

      expect(currentState).toBe('idle');

      const onWalk = jest.fn(() => {
        expect(machine.currentState()).toBe('walk');
      });

      machine.on('walk', onWalk).process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(1);
    });

    it('can subscribe to state end events', () => {
      const onEndWalk = jest.fn();
      const onEndIdle = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('idle').when(data => !data.walk)
        .onEnd('idle', onEndIdle)
        .onEnd('walk', onEndWalk);

      expect(onEndIdle).not.toHaveBeenCalled();
      expect(onEndWalk).not.toHaveBeenCalled();

      machine.process({});
      expect(onEndIdle).not.toHaveBeenCalled();
      expect(onEndWalk).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onEndIdle).toHaveBeenCalledTimes(1);
      expect(onEndWalk).not.toHaveBeenCalled();

      machine.process({ walk: false });
      expect(onEndIdle).toHaveBeenCalledTimes(1);
      expect(onEndWalk).toHaveBeenCalledTimes(1);
    });

    it('can subscribe to a single state change once', () => {
      const onWalk = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)

      machine.once('walk', onWalk);
      expect(onWalk).not.toHaveBeenCalled();

      machine.process({ walk: false });
      expect(onWalk).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(1);

      machine.process({ walk: true });
      expect(onWalk).toHaveBeenCalledTimes(1);
    });

    it('can manually unsubscribe too', () => {
      const onWalk = jest.fn();
      const onIdle = jest.fn();

      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('idle').when(data => !data.walk)
        .onEvery('walk', onWalk)
        .onEvery('idle', onIdle)
        .init({});

      expect(onIdle).toHaveBeenCalledTimes(1);
      expect(onWalk).not.toHaveBeenCalled();
      expect(machine.currentState()).toBe('idle');

      machine.process({});
      expect(onIdle).toHaveBeenCalledTimes(2);
      expect(onWalk).not.toHaveBeenCalled();

      machine.process({ walk: true });
      expect(onIdle).toHaveBeenCalledTimes(2);
      expect(onWalk).toHaveBeenCalledTimes(1);

      machine.process({ walk: true });
      expect(onIdle).toHaveBeenCalledTimes(2);
      expect(onWalk).toHaveBeenCalledTimes(2);

      machine.off('walk', onWalk);

      machine.process({ walk: true });
      expect(onIdle).toHaveBeenCalledTimes(2);
      expect(onWalk).toHaveBeenCalledTimes(2);

      machine.process({});
      expect(onIdle).toHaveBeenCalledTimes(3);
      expect(onWalk).toHaveBeenCalledTimes(2);
    });
  });

  describe('is()', () => {
    it('returns true if current state matches the given state', () => {
      const machine = StateMachine<any>('idle').transitionTo('walk').when(data => data.walk);
      expect(machine.is('idle')).toBe(true);
      expect(machine.is('walk')).toBe(false);

      machine.process({ walk: true });
      expect(machine.is('idle')).toBe(false);
      expect(machine.is('walk')).toBe(true);
    });

    it('returns true if current state is one of the given states', () => {
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .transitionTo('fly').when(data => data.fly);

      expect(machine.is('walk', 'idle')).toBe(true);
      expect(machine.is('walk', 'fly')).toBe(false);
    });
  });

  describe('timers()', () => {
    const getMachine = () =>
      StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('idle').when(
          (data, meta) => {
            return !data.walk && !!meta.duration && (meta.duration > 1)
          }
        );

    it('passes accumulated delta time as duration to predicate', () => {
      const machine = getMachine().timers();
      expect(machine.currentState()).toBe('idle');

      machine.process({ walk: true, dt: 0.51 });
      expect(machine.currentState()).toBe('walk');

      machine.process({ walk: false, dt: 0.23 });
      expect(machine.currentState()).toBe('walk');

      machine.process({ walk: false, dt: 0.45 });
      expect(machine.currentState()).toBe('walk');

      machine.process({ walk: false, dt: 0.52 });
      expect(machine.currentState()).toBe('idle');
    });
  });

  it('passes accumulated delta time as duration to event callbacks', () => {
    const machine = StateMachine<any>('idle')
      .transitionTo('walk').when(data => data.walk)
      .state('walk').transitionTo('idle').when((data, { duration = 0 }) => !data.walk && duration > 10)
      .timers()
      .init({});

    let duration: number | null = 0;
    machine.onEvery('walk', (_, { duration: d }) => {
      duration = d;
    });

    machine.process({ walk: true, dt: 0.25 });
    expect(duration).toBe(0);

    machine.process({ walk: true, dt: 0.4 });
    expect(duration).toBe(0.4);

    machine.process({ walk: true, dt: 0.75 });
    expect(duration).toBe(1.15);
  });

  it('passes accumulated duration to callbacks applied via transition matcher', () => {
    const machine = StateMachine<any>('idle')
      .transitionTo('walk').when(data => data.walk)
      .state('walk').transitionTo('idle').when((data, { duration = 0 }) => !data.walk && duration > 10)
      .timers()
      .init({});

    const callback = jest.fn();
    machine.on({ from: 'idle', to: 'walk' }, callback);

    machine.process({ walk: false, dt: 0.25 });
    machine.process({ walk: false, dt: 0.35 });
    machine.process({ walk: true,  dt: 0.5 });

    expect(callback).toHaveBeenCalledWith(
      { walk: true,  dt: 0.5 },
      { from: 'idle', to: 'walk', duration: 1.1, tickCount: 2 },
    );
  });

  describe('init()', () => {
    const walker = () => StateMachine<any>('idle')
      .timers('dt')
      .transitionTo('walk').when(data => data.walk)
      .state('walk').transitionTo('idle').when(data => !data.walk);

    it('on a new machine, just enters the initial state', () => {
      const onIdle = jest.fn();
      const machine = walker().on('idle', onIdle).init({ dt: 0 });

      expect(machine.currentState()).toBe('idle');
      expect(machine.previousState()).toBe(null);
      expect(onIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledWith({ dt: 0 }, { from: null, to: 'idle', tickCount: 0, duration: 0 });
    });

    it('called again, returns to the initial state from wherever the machine is', () => {
      const machine = walker().init({ dt: 0 });
      machine.process({ walk: true, dt: 1 });
      machine.process({ walk: true, dt: 1 });
      expect(machine.currentState()).toBe('walk');

      machine.init({ dt: 0 });
      expect(machine.currentState()).toBe('idle');
      expect(machine.previousState()).toBe(null);
      expect(machine.states.idle.tickCount).toBe(0);
      expect(machine.states.idle.duration).toBe(0);

      // Carries on from the initial state, with fresh timers.
      machine.process({ walk: false, dt: 1 });
      expect(machine.currentState()).toBe('idle');
      expect(machine.states.idle.duration).toBe(1);
      machine.process({ walk: true, dt: 1 });
      expect(machine.currentState()).toBe('walk');
      expect(machine.previousState()).toBe('idle');
    });

    it('ends the state it leaves, then enters the initial state with from: null', () => {
      const calls: string[] = [];
      const machine = walker()
        .onEnd('walk', (_, meta) => calls.push(`end walk -> ${meta.to}`))
        .on('idle', (_, meta) => calls.push(`enter idle from ${meta.from}`))
        .onEvery('idle', () => calls.push('tick idle'))
        .init({ dt: 0 });
      machine.process({ walk: true, dt: 1 });
      calls.length = 0;

      machine.init({ dt: 0 });
      expect(calls).toEqual(['end walk -> idle', 'enter idle from null', 'tick idle']);
    });

    it('restarts the initial state when called from it', () => {
      const onIdle = jest.fn();
      const machine = walker().on('idle', onIdle).init({ dt: 0 });
      machine.process({ dt: 2 });
      machine.process({ dt: 2 });
      expect(machine.states.idle.duration).toBe(4);

      machine.init({ dt: 0 });
      expect(onIdle).toHaveBeenCalledTimes(2);
      expect(machine.states.idle.duration).toBe(0);
      expect(machine.states.idle.tickCount).toBe(0);
    });

    it('never fires transition subscriptions that name a from', () => {
      const walkToIdle = jest.fn();
      const anyToIdle = jest.fn();
      const machine = walker()
        .on({ from: 'walk', to: 'idle' }, walkToIdle)
        .on({ to: 'idle' }, anyToIdle)
        .init({ dt: 0 });
      machine.process({ walk: true, dt: 1 });
      machine.init({ dt: 0 });

      expect(walkToIdle).not.toHaveBeenCalled();
      // A matcher without a from matches entry to the initial state, as on a first init.
      expect(anyToIdle).toHaveBeenCalledTimes(2);

      machine.process({ walk: true, dt: 1 });
      machine.process({ walk: false, dt: 1 });
      expect(walkToIdle).toHaveBeenCalledTimes(1);
    });

    it('keeps subscriptions across re-inits', () => {
      const onWalk = jest.fn();
      const machine = walker().onEvery('walk', onWalk).init({ dt: 0 });
      machine.process({ walk: true, dt: 1 });
      machine.init({ dt: 0 });
      machine.process({ walk: true, dt: 1 });
      machine.process({ walk: true, dt: 1 });

      expect(onWalk).toHaveBeenCalledTimes(3);
    });

    it('is immediate, regardless of the current state\'s forAtLeast', () => {
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').forAtLeast(100).transitionTo('idle').when(data => !data.walk)
        .init({});
      machine.process({ walk: true });
      machine.process({ walk: false });
      expect(machine.currentState()).toBe('walk');

      machine.init({});
      expect(machine.currentState()).toBe('idle');
    });

    it('also ends the current state of a machine that was only ever processed', () => {
      const onEndWalk = jest.fn();
      const machine = walker().onEnd('walk', onEndWalk);
      machine.process({ walk: true, dt: 1 });
      expect(machine.currentState()).toBe('walk');

      machine.init({ dt: 0 });
      expect(onEndWalk).toHaveBeenCalledTimes(1);
      expect(machine.currentState()).toBe('idle');
    });
  });

  describe('fromAny()', () => {
    const creature = () => StateMachine<any>('idle')
      .transitionTo('walk').when(data => data.walk)
      .state('walk').transitionTo('idle').when(data => !data.walk)
      .fromAny().transitionTo('dead').when(data => data.kill)
      .state('dead').transitionTo('idle').when(data => data.respawn);

    it('transitions from every state when its predicate holds', () => {
      for (const walk of [false, true]) {
        const machine = creature().init({});
        machine.process({ walk });
        expect(machine.currentState()).toBe(walk ? 'walk' : 'idle');

        machine.process({ walk, kill: true });
        expect(machine.currentState()).toBe('dead');
        expect(machine.previousState()).toBe(walk ? 'walk' : 'idle');
      }
    });

    it('never transitions its target to itself, and needs no same-state guard', () => {
      const onDead = jest.fn();
      const machine = creature().on('dead', onDead).init({});
      machine.process({ kill: true });
      machine.process({ kill: true });
      machine.process({ kill: true });

      expect(machine.currentState()).toBe('dead');
      expect(onDead).toHaveBeenCalledTimes(1);
    });

    it('lasts until the next state(), which declares that state\'s own transitions as usual', () => {
      const machine = creature().init({});
      machine.process({ kill: true });
      machine.process({ respawn: true });
      expect(machine.currentState()).toBe('idle');

      // respawn was declared for 'dead' only, not from any state.
      machine.process({ walk: true });
      machine.process({ walk: true, respawn: true });
      expect(machine.currentState()).toBe('walk');
    });

    it('can list states it does not apply to', () => {
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .fromAny('idle').transitionTo('dead').when(data => data.kill)
        .init({});
      machine.process({ kill: true });
      expect(machine.currentState()).toBe('idle');

      machine.process({ walk: true });
      machine.process({ kill: true });
      expect(machine.currentState()).toBe('dead');
    });

    it('interrupts: checked before a state\'s own transitions, and ignores its forAtLeast', () => {
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').forAtLeast(100).transitionTo('run').when(data => data.run)
        .fromAny().transitionTo('dead').when(data => data.kill)
        .init({});
      machine.process({ walk: true });
      machine.process({ run: true, kill: true });

      expect(machine.currentState()).toBe('dead');
    });

    it('supports several transitions, checked in the order declared', () => {
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .fromAny()
        .transitionTo('dead').when(data => data.kill)
        .transitionTo('stunned').when(data => data.hit).or(data => data.kill)
        .init({});
      machine.process({ hit: true });
      expect(machine.currentState()).toBe('stunned');

      machine.process({ kill: true });
      expect(machine.currentState()).toBe('dead');
    });

    it('runs the target\'s entry callbacks with the state it came from', () => {
      const onDead = jest.fn();
      const machine = creature().on('dead', onDead).init({});
      machine.process({ walk: true });
      machine.process({ walk: true, kill: true });

      expect(onDead).toHaveBeenCalledWith({ walk: true, kill: true }, expect.objectContaining({ from: 'walk', to: 'dead' }));
    });
  });

  describe('transition subscriptions added after their target state was entered', () => {
    it('still fire', () => {
      const before = jest.fn();
      const after = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('idle').when(data => !data.walk)
        .on({ from: 'walk', to: 'idle' }, before)
        .init({});
      // 'idle' has now been entered once.
      machine.on({ from: 'walk', to: 'idle' }, after);

      machine.process({ walk: true });
      machine.process({ walk: false });
      expect(before).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledTimes(1);
    });

    it('including once(), which still unsubscribes after firing', () => {
      const once = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('idle').when(data => !data.walk)
        .init({});
      machine.process({ walk: true });
      machine.process({ walk: false });
      // Both states have been entered; subscribe once to the next entry of each.
      machine.once('walk', once);
      machine.once('idle', once);

      machine.process({ walk: true });
      machine.process({ walk: false });
      machine.process({ walk: true });
      machine.process({ walk: false });
      expect(once).toHaveBeenCalledTimes(2);
    });

    it('survive other subscriptions being removed by once()', () => {
      const once = jest.fn();
      const always = jest.fn();
      const machine = StateMachine<any>('idle')
        .transitionTo('walk').when(data => data.walk)
        .state('walk').transitionTo('idle').when(data => !data.walk)
        .init({});
      machine.once('walk', once);
      machine.on({ to: 'walk' }, always);

      for (let i = 0; i < 3; i++) {
        machine.process({ walk: true });
        machine.process({ walk: false });
        // Added between entries, after once() has already unsubscribed.
        if (i === 0) machine.on({ to: 'walk' }, always);
      }
      expect(once).toHaveBeenCalledTimes(1);
      expect(always).toHaveBeenCalledTimes(3 + 2);
    });
  });
});
