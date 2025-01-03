type Metadata<TData> = {
  from: string | null,
  to: string,
  tickCount: number,
  shouldUnsubscribe?: (
    dataWithMeta: {
      data: TData,
      /** @description The number of times the given state has been entered */
      timesEnteredCount: number,
      /** @description The number of ticks of the current state */
      tickCount: number
    }
  ) => boolean };
type Callback<TData> = (() => void) | ((data: TData) => void) | ((data: TData, metadata: Metadata<TData>) => void);

export type State<TData> = {
  name: string;
  transitions: PredicateTransition<TData>[];
  init: Callback<TData>;
  tick: Callback<TData>;
  exit: Callback<TData>;
  minTicks: number | (() => number);
  tickCount: number;
  stateChangeSubscriptions: Callback<TData>[];
  stateTickSubscriptions: Callback<TData>[];
  stateEndSubscriptions: Callback<TData>[];
  subscriptionsViaMatcher: [Partial<Metadata<TData>>, Callback<TData>][];
}

type StateDict<TData> = { [Key: string]: State<TData> }
type Predicate<TData> = { (data: TData): boolean      }

type PredicateTransition<TData> = {
  predicate: Predicate<TData>,
  state: string, // could be State rather than string?
}

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

  states: StateDict<TData>;
};

const toMinTicks = (val: number | (() => number)) => typeof val === 'number' ? val : val();

const State = <TData>(name: string, getMinTicks: number | (() => number) = 0): State<TData> => {
  // event subscriptions
  const stateChangeSubscriptions: Callback<TData>[] = [];
  const stateTickSubscriptions: Callback<TData>[] = [];
  const stateEndSubscriptions: Callback<TData>[] = [];

  // These tuples represent subscriptions to a state via a transition matcher:
  // [matcher, callback] where the matcher will be matched against the metadata of each transition
  // to determine whether the callback should be called.
  let subscriptionsViaMatcher: [Metadata<TData>, Callback<TData>][] = [];

  let minTicks = toMinTicks(getMinTicks);
  let tickCount = 0;
  let timesEnteredCount = 0;

  const callMatchingSubscriptions = (data: TData, metadata: Metadata<TData>) =>
    /** @description
     * Returns the boolean value of shouldUnsubscribe if present or false
     * This is used to determine whether the subscription should be removed after being called.
     */
    ([matcher, callback]: [Metadata<TData>, Callback<TData>]): void => {
      if (
        (!matcher.from || matcher.from === metadata.from) &&
        (!matcher.to || matcher.to === metadata.to)
      ) {
        callback(data, metadata);
        // if (metadata.shouldUnsubscribe) return metadata.shouldUnsubscribe({ data, timesEnteredCount, tickCount });
      }
      // return false;
    };

  const filterByMatcher = (metadata: Partial<Metadata<TData>>) => {
    return ([matcher]: [Metadata<TData>, Callback<TData>]) => {
      return (!matcher.from || matcher.from === metadata.from) &&
      (!matcher.to || matcher.to === metadata.to)
    }
  };

  // TODO: treat all subscriptions as equal,
  // here calling init(fn) makes fn a special case kind of subscription
  // possibly useful for order/priority of execution, but probably unnecessary complexity
  const initialiser = (fn: Callback<TData> = () => {}) => (data: TData, metadata: Metadata<TData>) => {
    timesEnteredCount++;
    minTicks = toMinTicks(getMinTicks);
    tickCount = 0;
    fn(data, metadata);
    stateChangeSubscriptions.forEach(subscription => subscription(data, metadata));
    stateTickSubscriptions.forEach(subscription => subscription(data, metadata));

    const matchedSubscriptions = subscriptionsViaMatcher.filter(filterByMatcher(metadata));
    matchedSubscriptions.forEach(([, callback]) => callback(data, metadata));

    // remove subscriptions that should be unsubscribed
    const shouldUnsubscribe = matchedSubscriptions.filter(([matcher]) => matcher.shouldUnsubscribe?.({ data, timesEnteredCount, tickCount }));
    subscriptionsViaMatcher = subscriptionsViaMatcher.filter(sub => !shouldUnsubscribe.includes(sub));
  };

  let init = initialiser();

  const ticker = (fn: Callback<TData> = () => {}) => (data: TData, metadata: Metadata<TData>) => {
    tickCount++;
    stateTickSubscriptions.forEach(subscription => subscription(data, { ...metadata, tickCount }));
    subscriptionsViaMatcher.forEach(callMatchingSubscriptions(data, { ...metadata, tickCount }));

    fn(data, { ...metadata, tickCount });
  };

  let tick = ticker();

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

    set init(fn) {
      init = initialiser(fn);
    },
    get init() {
      return init;
    },

    set tick(fn) {
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

    exit(data: TData, metadata: Metadata<TData>) {
      stateEndSubscriptions.forEach(subscription => subscription(data, metadata));
    },
  }
};

export const StateMachine = <TData>(initialState: string): TStateMachine<TData> => {
  const states: StateDict<TData> = {
    [initialState]: State(initialState),
  };

  // subscriptions
  const onTicks: Callback<TData>[] = [];

  // states used by the monad when building state graph
  let homeState = states[initialState];
  let destState = homeState;
  let currentStateName = initialState;

  const machine: TStateMachine<TData> = {
    transitionTo: stateName => {
      if (stateName === homeState.name) {
        throw new TypeError(`Cannot transition to same state: '${stateName}'`)
      }

      destState = states[stateName] = states[stateName] || State(stateName);

      return machine;
    },
    when: predicate => {
      if (homeState.name === destState.name) {
        throw new TypeError(`Cannot transition to same state: '${destState.name}'`)
      }
      homeState.transitions.push({ predicate, state: destState.name });
      return machine;
    },
    or: predicate => {
      if (homeState.name === destState.name) {
        throw new TypeError(`Cannot transition to same state: '${destState.name}'`)
      }
      homeState.transitions.push({ predicate, state: destState.name });
      return machine;
    },
    andThen: (fn: Callback<TData>) => {
      destState.init = fn;
      return machine;
    },
    tick: (fn: Callback<TData>) => {
      destState.tick = fn;
      return machine;
    },
    exit: (fn: Callback<TData>) => {
      destState.exit = fn;
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
      init(data, { from: null, to: initialState, tickCount: 0 });
      return machine;
    },
    process: data => {
      const currentState = states[currentStateName];
      const { tickCount, minTicks } = currentState;
      const transitions: PredicateTransition<TData>[] = states[currentStateName].transitions;
      const transition = transitions.find(transition => transition.predicate(data));

      if (transition && tickCount >= toMinTicks(minTicks)) {
        currentState.exit(data, { from: currentStateName, to: transition.state, tickCount });

        const prevState = currentState;
        const nextState = states[transition.state];
        currentStateName = nextState.name;

        nextState.init && nextState.init(data, { from: prevState.name, to: nextState.name, tickCount: 0 });
      } else {
        currentState.tick(data, { from: currentStateName, to: currentStateName, tickCount });
        onTicks.forEach(fn => fn(data, { from: currentStateName, to: currentStateName, tickCount }));
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
    states,
  };

  return machine;
};
