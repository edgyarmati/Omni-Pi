export type OmniRpcCommandType =
  | "prompt"
  | "steer"
  | "follow_up"
  | "abort"
  | "new_session"
  | "switch_session"
  | "fork"
  | "get_state"
  | "get_messages"
  | "get_session_stats"
  | "get_available_models"
  | "set_model"
  | "set_thinking_level"
  | "set_steering_mode"
  | "set_follow_up_mode";

export interface OmniRpcCommand {
  id?: string;
  type: OmniRpcCommandType;
  [key: string]: unknown;
}

export interface OmniRpcSuccessResponse<T = unknown> {
  id?: string;
  type: "response";
  command: string;
  success: true;
  data?: T;
}

export interface OmniRpcErrorResponse {
  id?: string;
  type: "response";
  command: string;
  success: false;
  error: string;
}

export type OmniRpcResponse<T = unknown> =
  | OmniRpcSuccessResponse<T>
  | OmniRpcErrorResponse;

export type OmniRpcEventType =
  | "agent_start"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "queue_update"
  | "compaction_start"
  | "compaction_end"
  | "auto_retry_start"
  | "auto_retry_end"
  | "extension_error"
  | "extension_ui_request";

export interface OmniRpcEvent {
  type: OmniRpcEventType;
  [key: string]: unknown;
}

export interface OmniRpcExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text";
  [key: string]: unknown;
}

export interface OmniRpcExtensionUiResponse {
  type: "extension_ui_response";
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

export function isOmniRpcResponse(value: unknown): value is OmniRpcResponse {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "response"
  );
}

export function isOmniRpcEvent(value: unknown): value is OmniRpcEvent {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string" &&
    (value as { type?: string }).type !== "response"
  );
}
