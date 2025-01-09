type Metadata<TData> = {
  from: string | null,
  to: string,
  tickCount: number,
  delta?: number,
  duration: number | null,
  shouldUnsubscribe?: (
    dataWithMeta: {
      data: TData,
      /** @description The number of times the given state has been entered */
      timesEnteredCount: number,
      /** @description The number of ticks of the current state */
      tickCount: number
    }
  ) => boolean };

type InitData = { from: string | null; recordDuration: boolean };
type Callback<TData> = (() => void) | ((data: TData) => void) | ((data: TData, metadata: Metadata<TData>) => void);
type InitCallback<TData> = (data: TData, metadata: InitData) => void;
type TickCallback<TData> = (data: TData, metadata: { delta?: number }) => void;

export type State<TData> = {
  name: string;
  transitions: PredicateTransition<TData>[];
  init: InitCallback<TData>;
  setInit: (fn: Callback<TData>) => void;
  tick: TickCallback<TData>;
  setTick: (fn: Callback<TData>) => void;
  exit: Callback<TData>; // TODO make consistent with above
  setExit: (fn: Callback<TData>) => void;
  minTicks: number | (() => number);
  tickCount: number;
  duration: number | null;
  stateChangeSubscriptions: Callback<TData>[];
  stateTickSubscriptions: Callback<TData>[];
  stateEndSubscriptions: Callback<TData>[];
  subscriptionsViaMatcher: [Partial<Metadata<TData>>, Callback<TData>][];
}

type StateDict<TData> = { [Key: string]: State<TData> }
type Predicate<TData> = { (data: TData, metadata: { tickCount: number, deltaAlias?: string, duration?: number }): boolean }

type PredicateTransition<TData> = {
  predicate: Predicate<TData>,
  state: string, // could be State rather than string?
};

export type TStateMachine<TData> = {
  // Builder functions for declaring state graph
  transitionTo: (stateName: string) => TStateMachine<TData>;
  when: (predicate: Predicate<TData>) => TStateMachine<TData>;
  or: (predicate: Predicate<TData>) => TStateMachine<TData>;
  andThen: (init: Callback<TData>) => TStateMachine<TData>;
  tick: (tick: Callback<TData>) => TStateMachine<TData>;
  exit: (exit: Callback<TData>) => TStateMachine<TData>;
  forAtLeast: (countOrFn: number | (() => number)) => TStateMachine<TData>;
  state: (stateName: string) => TStateMachine<TData>;

  // Event subscription
  on: (stateName: string | Partial<Metadata<TData>>, fn: Callback<TData>, modifier?: 'begin' | 'every' | 'end') => TStateMachine<TData>;
  once: (stateName: string, fn: Callback<TData>) => TStateMachine<TData>;
  off: (stateName: string, fn: Callback<TData>) => TStateMachine<TData>;
  onEvery: (stateName: string, fn: Callback<TData>) => TStateMachine<TData>;
  onEnd: (stateName: string, fn: Callback<TData>) => TStateMachine<TData>;

  // Top-level controls
  currentState: () => string;
  process: (data: TData) => TStateMachine<TData>;
  init: (data: TData) => TStateMachine<TData>;
  timers: (deltaAlias?: string) => TStateMachine<TData>;

  states: StateDict<TData>;
};

const toMinTicks = (val: number | (() => number)) => typeof val === 'number' ? val : val();

const callMatchingSubscriptions = <T>(data: T, metadata: Metadata<T>) =>
  ([matcher, callback]: [Metadata<T>, Callback<T>]): void => {
    if (
      (!matcher.from || matcher.from === metadata.from) &&
      (!matcher.to || matcher.to === metadata.to)
    ) {
      callback(data, metadata);
    }
  };

const filterByMatcher = <T>(metadata: Partial<Metadata<T>>) => {
  return ([matcher]: [Metadata<T>, Callback<T>]) => {
    return (!matcher.from || matcher.from === metadata.from) &&
    (!matcher.to || matcher.to === metadata.to)
  }
};

const State = <TData>(
  name: string,
  getMinTicks: number | (() => number) = 0,
): State<TData> => {
  // event subscriptions
  const stateChangeSubscriptions: Callback<TData>[] = [],
        stateTickSubscriptions: Callback<TData>[] = [],
        stateEndSubscriptions: Callback<TData>[] = [];

  // These tuples represent subscriptions to a state via a transition matcher:
  // [matcher, callback] where the matcher will be matched against the metadata of each transition
  // to determine whether the callback should be called.
  let subscriptionsViaMatcher: [Metadata<TData>, Callback<TData>][] = [],
      minTicks = toMinTicks(getMinTicks),
      tickCount = 0,
      timesEnteredCount = 0,
      duration: number | null = null;

  // TODO: treat all subscriptions as equal,
  // here calling init(fn) makes fn a special case kind of subscription
  // possibly useful for order/priority of execution, but probably unnecessary complexity
  const initialiser = (fn: Callback<TData> = () => {}) => (data: TData, initData: { from: string | null; recordDuration: boolean }) => {
    if (initData.recordDuration) duration = 0;
    console.log('init', { initData, to: name, duration });

    timesEnteredCount++;
    minTicks = toMinTicks(getMinTicks);
    tickCount = 0;

    const metadata: Metadata<TData> = {
      from: initData.from,
      to: name,
      tickCount,
      duration,
    };
    fn(data, metadata);
    stateChangeSubscriptions.forEach(subscription => subscription(data, metadata));
    stateTickSubscriptions.forEach(subscription => subscription(data, metadata));

    const matchedSubscriptions = subscriptionsViaMatcher.filter(filterByMatcher(metadata));
    matchedSubscriptions.forEach(([, callback]) => callback(data, metadata));

    // remove subscriptions that should be unsubscribed
    const shouldUnsubscribe = matchedSubscriptions.filter(([matcher]) => matcher.shouldUnsubscribe?.({ data, timesEnteredCount, tickCount }));
    subscriptionsViaMatcher = subscriptionsViaMatcher.filter(sub => !shouldUnsubscribe.includes(sub));
  };

  const ticker = (fn: Callback<TData> = () => {}) => (data: TData, tickMetadata: { delta?: number }) => {
    const { delta } = tickMetadata;
    if (delta && typeof duration === 'number') duration += delta;

    tickCount++;

    const metadata: Metadata<TData> = {
      from: name,
      to: name,
      tickCount,
      duration,
    };

    stateTickSubscriptions.forEach(subscription => subscription(data, metadata));
    subscriptionsViaMatcher.forEach(callMatchingSubscriptions(data, metadata));

    fn(data, metadata);
  };

  let init = initialiser(),
      tick = ticker();

  return {
    name,
    transitions: [],
    stateChangeSubscriptions,
    stateTickSubscriptions,
    stateEndSubscriptions,
    subscriptionsViaMatcher,

    get tickCount() {
      return tickCount;
    },

    get duration() {
      return duration;
    },

    setInit(fn) {
      init = initialiser(fn);
    },
    get init() {
      return init;
    },

    setTick(fn) {
      tick = ticker(fn);
    },
    get tick() {
      return tick;
    },

    set minTicks(countOrFn) {
      getMinTicks = countOrFn;
    },
    get minTicks() {
      return minTicks;
    },

    setExit(fn) {
      stateEndSubscriptions.push(fn);
    },
    exit(data: TData, metadata: Metadata<TData>) {
      stateEndSubscriptions.forEach(subscription => subscription(data, metadata));
    },
  }
};

export const preventTransitionToSameState = (a: string, b: string) => {
  if (a === b) {
    throw new Error(`Cannot transition to same state: '${a}'`);
  }
};

export const StateMachine = <TData>(initialState: string): TStateMachine<TData> => {
  const states: StateDict<TData> = {
    [initialState]: State(initialState),
  };

  // subscriptions
  const onTicks: Callback<TData>[] = [];

  // states used by the monad when building state graph
  let homeState = states[initialState],
      destState = homeState,
      currentStateName = initialState,
      deltaAlias: string | undefined;

  const machine: TStateMachine<TData> = {
    transitionTo: stateName => {
      preventTransitionToSameState(stateName, homeState.name);
      destState = states[stateName] = states[stateName] || State(stateName);
      return machine;
    },
    when: predicate => {
      preventTransitionToSameState(homeState.name, destState.name);
      homeState.transitions.push({ predicate, state: destState.name });
      return machine;
    },
    or: predicate => {
      preventTransitionToSameState(homeState.name, destState.name);
      homeState.transitions.push({ predicate, state: destState.name });
      return machine;
    },
    andThen: (fn: Callback<TData>) => {
      destState.setInit(fn);
      return machine;
    },
    tick: (fn: Callback<TData>) => {
      destState.setTick(fn);
      return machine;
    },
    exit: (fn: Callback<TData>) => {
      destState.setExit(fn);
      return machine;
    },
    forAtLeast: countOrFn => {
      destState.minTicks = countOrFn;
      return machine;
    },
    state: stateName => {
      const nominatedState = states[stateName];
      if (!nominatedState) {
        throw new TypeError(`'${stateName}' not found in states: ${Object.keys(states)}`)
      }
      homeState = destState = nominatedState;
      return machine;
    },
    init: (data: TData) => {
      const { init } = states[initialState];
      init(data, { from: null, recordDuration: !!deltaAlias });
      return machine;
    },
    process: data => {
      const currentState = states[currentStateName];
      const { tickCount, minTicks } = currentState;
      const { transitions } = states[currentStateName];

      // TODO: move logic into state object
      const delta = deltaAlias ? data[deltaAlias] : null;
      const duration = deltaAlias ? currentState.duration + (delta || 0) : null;
      const transition = transitions.find(transition => transition.predicate(data, { tickCount, deltaAlias, duration }));

      if (transition && tickCount >= toMinTicks(minTicks)) {
        // TODO: move logic into state machine
        const duration = currentState.duration ? currentState.duration + (delta || 0) : null;
        currentState.exit(data, {
          from: currentStateName,
          to: transition.state,
          tickCount,
          duration,
        });

        const prevState = currentState;
        const nextState = states[transition.state];
        currentStateName = nextState.name;

        nextState.init && nextState.init(data, { from: prevState.name, recordDuration: !!deltaAlias });
      } else {
        currentState.tick(data, { delta });

        // TODO: move logic into state machine?
        const duration = currentState.duration ? currentState.duration + (delta || 0) : null;
        onTicks.forEach(fn => fn(data, { from: currentStateName, to: currentStateName, tickCount, duration }));
      }
      return machine;
    },
    currentState: () => currentStateName,
    on: (stateNameOrMatcher, fn, modifier: 'begin' | 'every' | 'end' = 'begin') => {
      if (stateNameOrMatcher === 'tick') {
        onTicks.push(fn);
        return machine;
      }

      if (typeof stateNameOrMatcher === 'string') {
        const targetState = states[stateNameOrMatcher];

        if (!targetState) {
          throw new TypeError(`Cannot subscribe to state '${stateNameOrMatcher}' because no state with that name exists.`)
        }

        const modifierToSubscriptionMap = {
          begin: targetState.stateChangeSubscriptions,
          every: targetState.stateTickSubscriptions,
          end: targetState.stateEndSubscriptions,
        };
        const subscriptions = modifierToSubscriptionMap[modifier];
        subscriptions.push(fn);
      }

      if (typeof stateNameOrMatcher === 'object') {
        const { from, to } = stateNameOrMatcher;

        if (!to) {
          throw new TypeError(`Metadata object must contain a 'to' property if subscribing via transition matcher.`)
        }

        const targetState = states[to];

        if (!targetState) {
          throw new TypeError(`Cannot subscribe to state '${to}' because no state with that name exists.`)
        }

        targetState.subscriptionsViaMatcher.push([stateNameOrMatcher, fn]);
      }

      return machine;
    },
    off(stateName, fn) {
      const targetState = states[stateName];

      if (!targetState) {
        throw new TypeError(`Cannot unsubscribe from state '${stateName}' because no state with that name exists.`)
      }

      const allSubs = [
        targetState.stateChangeSubscriptions,
        targetState.stateTickSubscriptions,
        targetState.stateEndSubscriptions,
      ];

      const subs = allSubs.find(sub => sub.includes(fn));
      if (!subs) return machine;

      const index = subs.indexOf(fn);
      if (index > -1) subs.splice(index, 1);

      return machine;
    },
    once: (stateName, fn) => {
      return machine.on({ to: stateName, shouldUnsubscribe: () => true }, fn);
    },
    onEvery: (stateName, fn) => {
      return machine.on(stateName, fn, 'every');
    },
    onEnd: (stateName, fn) => {
      return machine.on(stateName, fn, 'end');
    },
    timers(alias = 'dt') {
      deltaAlias = alias;
      return machine;
    },
    states,
  };

  return machine;
};
