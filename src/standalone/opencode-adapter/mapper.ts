import type { OmniStandaloneAppState } from "../contracts.js";
import type {
  OmniUiAdapterInput,
  OmniUiMessage,
  OmniUiSnapshot,
  OmniUiToolCall,
} from "./contracts.js";

function mapToolCall(input: OmniUiToolCall): OmniUiToolCall {
  return {
    id: input.id,
    name: input.name,
    status: input.status,
    input: input.input,
    output: input.output,
  };
}

function mapMessage(message: OmniUiAdapterInput["conversation"][number]): OmniUiMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    streaming: message.streaming === true,
    statusText: message.statusText,
    toolCalls: (message.toolCalls ?? []).map(mapToolCall),
  };
}

export function toOmniUiSnapshot(input: OmniUiAdapterInput): OmniUiSnapshot {
  return {
    statuses: input.statuses,
    session: {
      id: input.session.sessionId,
      file: input.session.sessionFile,
      name: input.session.sessionName,
      model: input.session.modelLabel,
      thinking: input.session.thinkingLevel,
      streaming: input.session.isStreaming,
      steeringQueue: input.session.steeringQueue,
      followUpQueue: input.session.followUpQueue,
    },
    workflow: {
      phase: input.workflow.phase,
      activeTask: input.workflow.activeTask,
      statusSummary: input.workflow.statusSummary,
      blockers: input.workflow.blockers,
      nextStep: input.workflow.nextStep,
      todos: input.todos,
    },
    providers: input.providers,
    dialog: input.dialog,
    repoMapPreview: input.repoMapPreview,
    conversation: input.conversation.map(mapMessage),
  };
}

export function standaloneStateToOmniUiSnapshot(
  state: OmniStandaloneAppState,
): OmniUiSnapshot {
  return toOmniUiSnapshot({
    statuses: state.statuses,
    session: state.session,
    workflow: state.workflow,
    providers: state.providers,
    todos: state.todos,
    dialog: state.dialog,
    repoMapPreview: state.repoMapPreview,
    conversation: state.conversation.map((item) => ({
      id: item.id,
      role: item.role,
      text: item.text,
      streaming: item.streaming,
      statusText: item.statusText,
      toolCalls: (item.toolCalls ?? []).map((tool) => ({
        id: tool.id,
        name: tool.name,
        status: tool.status,
        input: tool.inputText,
        output: tool.outputText,
      })),
    })),
  });
}
