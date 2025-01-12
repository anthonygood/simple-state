type Metadata<TData, StateName extends string = string> = {
  from: StateName | null,
  to: StateName,
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

type InitData<StateName extends string = string> = { from: StateName | null; recordDuration: boolean };
type Callback<TData, StateName extends string = string> = (() => void) | ((data: TData) => void) | ((data: TData, metadata: Metadata<TData, StateName>) => void);
type InitCallback<TData, StateName extends string = string> = (data: TData, metadata: InitData<StateName>) => void;
type TickCallback<TData> = (data: TData, metadata: { delta?: number }) => void;

export type State<TData, StateName extends string = string> = {
  name: StateName;
  transitions: PredicateTransition<TData, StateName>[];
  init: InitCallback<TData, StateName>;
  setInit: (fn: Callback<TData, StateName>) => void;
  tick: TickCallback<TData>;
  setTick: (fn: Callback<TData, StateName>) => void;
  exit: Callback<TData, StateName>; // TODO make consistent with above
  setExit: (fn: Callback<TData, StateName>) => void;
  minTicks: number | (() => number);
  minDuration: number | (() => number);
  tickCount: number;
  duration: number | null;
  stateChangeSubscriptions: Callback<TData, StateName>[];
  stateTickSubscriptions: Callback<TData, StateName>[];
  stateEndSubscriptions: Callback<TData, StateName>[];
  subscriptionsViaMatcher: [Partial<Metadata<TData, StateName>>, Callback<TData, StateName>][];
}

type StateDict<TData, StateName extends string = string> = { [Key: string]: State<TData, StateName> }
type Predicate<TData> = { (data: TData, metadata: { tickCount: number, duration?: number }): boolean }

type PredicateTransition<TData, StateName extends string = string> = {
  predicate: Predicate<TData>,
  state: StateName, // could be State rather than string?
};

export type TStateMachine<TData, StateName extends string = string> = {
  // Builder functions for declaring state graph
  transitionTo: (stateName: StateName) => TStateMachine<TData, StateName>;
  when: (predicate: Predicate<TData>) => TStateMachine<TData, StateName>;
  or: (predicate: Predicate<TData>) => TStateMachine<TData, StateName>;
  andThen: (init: Callback<TData, StateName>) => TStateMachine<TData, StateName>;
  tick: (tick: Callback<TData, StateName>) => TStateMachine<TData, StateName>;
  exit: (exit: Callback<TData, StateName>) => TStateMachine<TData, StateName>;
  forAtLeast: (countOrFn: number | (() => number), ticksOrDuration?: 'ticks' | 'duration') => TStateMachine<TData, StateName>;
  state: (stateName: StateName) => TStateMachine<TData, StateName>;

  // Event subscription
  on:      (stateName: StateName | Partial<Metadata<TData, StateName>>, fn: Callback<TData, StateName>, modifier?: 'begin' | 'every' | 'end') => TStateMachine<TData, StateName>;
  once:    (stateName: StateName, fn: Callback<TData, StateName>) => TStateMachine<TData, StateName>;
  off:     (stateName: StateName, fn: Callback<TData, StateName>) => TStateMachine<TData, StateName>;
  onEvery: (stateName: StateName, fn: Callback<TData, StateName>) => TStateMachine<TData, StateName>;
  onEnd:   (stateName: StateName, fn: Callback<TData, StateName>) => TStateMachine<TData, StateName>;

  // Top-level controls
  currentState: () => StateName;
  previousState: () => StateName | null;
  process: (data: TData) => TStateMachine<TData, StateName>;
  init: (data: TData) => TStateMachine<TData, StateName>;
  timers: (deltaAlias?: string) => TStateMachine<TData, StateName>;

  states: StateDict<TData, StateName>;
};

const toNumber = (val: number | (() => number)) => typeof val === 'number' ? val : val();

const callMatchingSubscriptions = <T, S extends string>(data: T, metadata: Metadata<T, S>) =>
  ([matcher, callback]: [Metadata<T, S>, Callback<T, S>]): void => {
    if (
      (!matcher.from || matcher.from === metadata.from) &&
      (!matcher.to || matcher.to === metadata.to)
    ) {
      callback(data, metadata);
    }
  };

const filterByMatcher = <T, S extends string>(metadata: Partial<Metadata<T>>) => {
  return ([matcher]: [Metadata<T, S>, Callback<T, S>]) => {
    return (!matcher.from || matcher.from === metadata.from) &&
    (!matcher.to || matcher.to === metadata.to)
  }
};

const State = <TData, StateName extends string = string>(
  name: StateName,
  getMinTicks: number | (() => number) = 0,
  getMinDuration: number | (() => number) = 0,
): State<TData, StateName> => {
  // event subscriptions
  const stateChangeSubscriptions: Callback<TData, StateName>[] = [],
        stateTickSubscriptions: Callback<TData, StateName>[] = [],
        stateEndSubscriptions: Callback<TData, StateName>[] = [];

  // These tuples represent subscriptions to a state via a transition matcher:
  // [matcher, callback] where the matcher will be matched against the metadata of each transition
  // to determine whether the callback should be called.
  let subscriptionsViaMatcher: [Metadata<TData, StateName>, Callback<TData, StateName>][] = [],
      minTicks = 0,
      minDuration = 0,
      tickCount = 0,
      timesEnteredCount = 0,
      duration: number | null = null;

  // TODO: treat all subscriptions as equal,
  // here calling init(fn) makes fn a special case kind of subscription
  // possibly useful for order/priority of execution, but probably unnecessary complexity
  const initialiser = (fn: Callback<TData, StateName> = () => {}): InitCallback<TData, StateName> => (data: TData, initData: InitData<StateName>) => {
    if (initData.recordDuration) duration = 0;

    timesEnteredCount++;
    minTicks = toNumber(getMinTicks);
    minDuration = toNumber(getMinDuration);
    tickCount = 0;

    const metadata: Metadata<TData, StateName> = {
      from: initData.from,
      to: name,
      tickCount,
      duration,
    };
    fn(data, metadata);
    stateChangeSubscriptions.forEach(subscription => subscription(data, metadata));
    stateTickSubscriptions.forEach(subscription => subscription(data, metadata));

    const matchedSubscriptions = subscriptionsViaMatcher.filter(filterByMatcher<TData, StateName>(metadata));
    matchedSubscriptions.forEach(([, callback]) => callback(data, metadata));

    // remove subscriptions that should be unsubscribed
    const shouldUnsubscribe = matchedSubscriptions.filter(([matcher]) => matcher.shouldUnsubscribe?.({ data, timesEnteredCount, tickCount }));
    subscriptionsViaMatcher = subscriptionsViaMatcher.filter(sub => !shouldUnsubscribe.includes(sub));
  };

  const ticker = (fn: Callback<TData, StateName> = () => {}) => (data: TData, tickMetadata: { delta?: number }) => {
    const { delta } = tickMetadata;
    if (delta && typeof duration === 'number') duration += delta;

    tickCount++;

    const metadata: Metadata<TData, StateName> = {
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

    set minDuration(durationOrFn) {
      getMinDuration = durationOrFn;
    },
    get minDuration() {
      return minDuration;
    },

    setExit(fn) {
      stateEndSubscriptions.push(fn);
    },
    exit(data: TData, metadata: Metadata<TData, StateName>) {
      stateEndSubscriptions.forEach(subscription => subscription(data, metadata));
    },
  }
};

export const preventTransitionToSameState = <StateName extends string>(a: StateName, b: StateName) => {
  if (a === b) {
    throw new Error(`Cannot transition to same state: '${a}'`);
  }
};

export const StateMachine = <TData, StateName extends string = string>(initialState: StateName): TStateMachine<TData, StateName> => {
  const states: StateDict<TData, StateName> = {
    [initialState]: State(initialState),
  };

  // subscriptions
  const onTicks: Callback<TData, StateName>[] = [];

  // states used by the monad when building state graph
  let homeState = states[initialState],
      destState = homeState,
      currentStateName = initialState,
      prevStateName: StateName | null = null,
      deltaAlias: string | undefined;

  const machine: TStateMachine<TData, StateName> = {
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
    andThen: (fn: Callback<TData, StateName>) => {
      destState.setInit(fn);
      return machine;
    },
    tick: (fn: Callback<TData, StateName>) => {
      destState.setTick(fn);
      return machine;
    },
    exit: (fn: Callback<TData, StateName>) => {
      destState.setExit(fn);
      return machine;
    },
    forAtLeast: (countOrFn, ticksOrDuration = 'ticks') => {
      if (ticksOrDuration !== 'ticks' && ticksOrDuration !== 'duration') {
        throw new TypeError(`'ticksOrDuration' must be either 'ticks' or 'duration'`)
      }
      if (ticksOrDuration === 'ticks') {
        destState.minTicks = countOrFn;
      }
      if (ticksOrDuration === 'duration') {
        destState.minDuration = countOrFn;
      }
      if (!deltaAlias && ticksOrDuration === 'duration') {
        machine.timers();
      }
      return machine
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
      const { tickCount, minTicks, minDuration } = currentState;

      if (minDuration && !deltaAlias) {
        machine.timers();
      }

      const { transitions } = states[currentStateName];

      const delta = deltaAlias ? data[deltaAlias] : null;
      // TODO: move logic into state object
      const duration = deltaAlias ? currentState.duration + (delta || 0) : null;
      const transition = transitions.find(
        transition => transition.predicate(data, {
          tickCount,
          duration,
        }));

      if (transition && tickCount >= toNumber(minTicks) && duration >= toNumber(minDuration)) {
        currentState.exit(data, {
          from: currentStateName,
          to: transition.state,
          tickCount,
          duration,
        });

        const prevState = currentState;
        const nextState = states[transition.state];
        prevStateName = currentStateName
        currentStateName = nextState.name;

        nextState.init && nextState.init(data, {
          from: prevState.name,
          recordDuration: !!deltaAlias,
        });
      } else {
        currentState.tick(data, { delta });
        onTicks.forEach(fn => fn(data, {
          from: currentStateName,
          to: currentStateName,
          tickCount,
          duration,
        }));
      }
      return machine;
    },
    currentState: () => currentStateName,
    previousState: () => prevStateName,
    on: (stateNameOrMatcher: StateName | Partial<Metadata<TData, StateName>>, fn: Callback<TData, StateName>, modifier: 'begin' | 'every' | 'end' = 'begin'): TStateMachine<TData, StateName> => {
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
    onEnd: (stateName: StateName, fn: Callback<TData, StateName>): TStateMachine<TData, StateName> => {
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
