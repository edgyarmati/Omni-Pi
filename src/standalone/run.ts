import { createStandaloneController } from "./controller.js";
import { runOpenTuiShell } from "./opentui-shell.js";
import { createOmniRpcClient } from "./rpc/client.js";

export async function runStandaloneApp(): Promise<void> {
  const client = createOmniRpcClient();
  const controller = createStandaloneController({ rpcClient: client });
  await runOpenTuiShell(controller);
}
