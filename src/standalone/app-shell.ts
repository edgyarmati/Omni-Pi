import {
  DEFAULT_STANDALONE_LAYOUT,
  type OmniStandaloneAppState,
} from "./contracts.js";

export interface OmniStandaloneShell {
  readonly state: OmniStandaloneAppState;
}

export function createStandaloneShellState(): OmniStandaloneAppState {
  return {
    layout: DEFAULT_STANDALONE_LAYOUT,
    statuses: [],
    workflow: {},
    repoMapPreview: "",
    session: {
      isStreaming: false,
      steeringQueue: [],
      followUpQueue: [],
    },
    todos: [],
    conversation: [],
  };
}

export function createStandaloneShell(): OmniStandaloneShell {
  return {
    state: createStandaloneShellState(),
  };
}
