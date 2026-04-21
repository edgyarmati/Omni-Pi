import {
  DEFAULT_STANDALONE_LAYOUT,
  type OmniStandaloneAppState,
} from "./contracts.js";
import { DEFAULT_PRESET, PRESETS } from "../theme.js";

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
    theme: {
      presetName: DEFAULT_PRESET,
      brand: PRESETS[DEFAULT_PRESET]?.brand ?? "#c5bceb",
      welcome: PRESETS[DEFAULT_PRESET]?.welcome ?? "#4969c9",
    },
    providers: {
      items: [],
      connectedProviderCount: 0,
      configuredProviderCount: 0,
      availableModelCount: 0,
      enabledModelCount: 0,
      hasAnyOAuthProvider: false,
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
