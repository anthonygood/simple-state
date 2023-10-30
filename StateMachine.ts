export type State<TData> = {
  name: string;
  transitions: PredicateTransition<TData>[];
  init: Function;
  tick: Function;
  exit: Function;
  minTicks: number | (() => number);
  tickCount: number;
  subscriptions: Function[];
}

type StateDict<TData> = { [Key: string]: State<TData> }
type Predicate<TData> = { (data: TData): boolean      }

type PredicateTransition<TData> = {
  predicate: Predicate<TData>,
  state: string, // could be State rather than string?
}

type Callback = (() => void) | ((TData) => void)

export type TStateMachine<TData> = {
  // Builder functions for declaring state graph
  transitionTo: (stateName: string) => TStateMachine<TData>;
  when: (predicate: Predicate<TData>) => TStateMachine<TData>;
  or: (predicate: Predicate<TData>) => TStateMachine<TData>;
  andThen: (init: Function) => TStateMachine<TData>;
  tick: (tick: Function) => TStateMachine<TData>;
  exit: (exit: Function) => TStateMachine<TData>;
  forAtLeast: (countOrFn: number | (() => number)) => TStateMachine<TData>;
  state: (stateName: string) => TStateMachine<TData>;

  // Event subscription
  on: (stateName: string, fn: Callback) => TStateMachine<TData>;

  // Top-level controls
  currentState: () => string;
  process: (data: TData) => TStateMachine<TData>;
  init: () => TStateMachine<TData>;

  states: StateDict<TData>;
};

const toMinTicks = (val: number | (() => number)) => typeof val === 'number' ? val : val();

const State = <TData>(name: string, getMinTicks: number | (() => number) = 0): State<TData> => {
  // event subscriptions
  const subscriptions: Callback[] = [];

  let minTicks = toMinTicks(getMinTicks);
  let tickCount = 0;

  const initialiser = (fn = (_data) => {}) => data => {
    fn(data);
    subscriptions.forEach(subscription => subscription(data));
    minTicks = toMinTicks(getMinTicks);
    tickCount = 0;
  };

  let init = initialiser();

  const ticker = (fn = (_data) => {}) => data => {
    tickCount++;
    fn(data);
  };

  let tick = ticker();

  return {
    name,
    transitions: [],
    subscriptions,

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

    exit: () => {},
  }
};

export const StateMachine = <TData>(initialState: string): TStateMachine<TData> => {
  const states: StateDict<TData> = {
    [initialState]: State(initialState),
  };

  // subscriptions
  const onTicks: Callback[] = [];

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
    andThen: (fn: Function) => {
      destState.init = fn;
      return machine;
    },
    tick: (fn: Function) => {
      destState.tick = fn;
      return machine;
    },
    exit: (fn: Function) => {
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
    init: () => {
      const { init } = states[initialState];
      init();
      return machine;
    },
    process: data => {
      const currentState = states[currentStateName];
      const { tickCount, minTicks } = currentState;
      const transitions: PredicateTransition<TData>[] = states[currentStateName].transitions;
      const transition = transitions.find(transition => transition.predicate(data));

      if (transition && tickCount >= minTicks) {
        currentState.exit(data);

        const nextState = states[transition.state];
        nextState.init && nextState.init(data);

        currentStateName = nextState.name;
      } else {
        currentState.tick(data);
        onTicks.forEach(fn => fn(data));
      }
      return machine;
    },
    currentState: () => currentStateName,
    on: (stateName, fn) => {
      if (stateName === 'tick') {
        onTicks.push(fn);
        return machine;
      }

      const targetState = states[stateName];

      if (!targetState) {
        throw new TypeError(`Cannot subscribe to state '${stateName}' because no state with that name exists.`)
      }

      targetState.subscriptions.push(fn);
      return machine;
    },
    states,
  };

  return machine;
};
