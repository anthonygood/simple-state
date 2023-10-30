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

      machine.init();
      expect(init1).toHaveBeenCalled()

      expect(init2).not.toHaveBeenCalled();
      machine.process({ walk: true })
      expect(init2).toHaveBeenCalled();
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
        .init();

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
      it('forAtLeast can declare minTicks for transition state', () => {
        const idleInit = jest.fn();
        const walkInit = jest.fn();
        const walkTick = jest.fn();

        // No idle tick callback, so should no-op for two ticks
        const machine = StateMachine<any>('idle').andThen(idleInit).forAtLeast(2)
          .transitionTo('walk').when(data => data.walk).or(data => data.run)
          // Expect walkTick to be called for 4 ticks
          .andThen(walkInit).tick(walkTick).forAtLeast(4)
          .state('walk').transitionTo('idle').when(data => !data.walk)
          .init();

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

      it('forAtLeast accepts function to define minTicks for transition state', () => {
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
          .init();

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
      })
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
  });
});
