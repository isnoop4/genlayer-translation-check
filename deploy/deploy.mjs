// Deploy TranslationCheck to GenLayer studionet (chain 61999).
// Usage:
//   PRIVATE_KEY=0x<testnet key> node deploy/deploy.mjs
// The key is read from the environment only. This script never prints it
// and never writes it anywhere. Use a testnet-only key.
// Optional env:
//   FAITHFUL_SCORE   default 85  total needed for FAITHFUL
//   DISTORTED_SCORE  default 60  total below this is DISTORTED
//   SCORE_BAND       default 10  leader/validator totals may differ by this
//   RPC_URL          default https://studio.genlayer.com/api
// Output: deployment.json in the repo root (addresses and tx hash only).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = process.env.RPC_URL || "https://studio.genlayer.com/api";
const PRIVATE_KEY = (process.env.PRIVATE_KEY || "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
  console.error("PRIVATE_KEY env must be 0x + 64 hex (a testnet-only key).");
  process.exit(2);
}

const num = (name, fallback) => Number(process.env[name] || fallback);
const ARGS = [num("FAITHFUL_SCORE", 85), num("DISTORTED_SCORE", 60), num("SCORE_BAND", 10)];
if (!ARGS.every(Number.isInteger) || !(ARGS[0] >= 2 && ARGS[0] <= 100 && ARGS[1] >= 1 && ARGS[1] < ARGS[0] && ARGS[2] >= 0 && ARGS[2] <= 30)) {
  console.error("need 1 <= DISTORTED_SCORE < FAITHFUL_SCORE <= 100 and 0 <= SCORE_BAND <= 30"); process.exit(2);
}

const { createAccount, createClient } = await import("genlayer-js");
const { studionet } = await import("genlayer-js/chains");
const { TransactionStatus } = await import("genlayer-js/types");

const account = createAccount(PRIVATE_KEY);
console.log("Deployer:", account.address);
const client = createClient({ chain: studionet, endpoint: RPC_URL, account });

const code = await readFile(path.join(ROOT, "contracts", "translation_check.py"), "utf-8");
// Studionet charges protocol fees: every deploy must carry a fee
// distribution and its fee value. Unused budget is refunded at finalization.
const est = await client.estimateTransactionFees();
const fees = { distribution: est.distribution, feeValue: est.feeValue };
console.log(`fee deposit: ${est.feeValue} wei`);
const deployTx = await client.deployContract({ code, args: ARGS, fees });
console.log("deploy tx:", deployTx);
let finalized = true;
try {
  await client.waitForTransactionReceipt({ hash: deployTx, status: TransactionStatus.FINALIZED, retries: 120, interval: 5000 });
} catch (e) {
  finalized = false;
  console.log("wait timed out (the tx may still finalize):", e.message);
}

// On fee-charging studionet the outer EVM receipt's `to` is the consensus
// contract, so the contract address is read from the GenLayer transaction.
const deployed = await client.getTransaction({ hash: deployTx });
const contract = deployed?.to_address || deployed?.recipient;
if (!/^0x[0-9a-fA-F]{40}$/.test(contract || "")) {
  throw new Error("could not resolve the contract address from the deploy transaction");
}
console.log(`status ${deployed.statusName}, result ${deployed.result_name}, execution ${deployed.txExecutionResultName}`);
if (deployed.txExecutionResultName !== "FINISHED_WITH_RETURN") {
  throw new Error("deploy did not execute cleanly: " + deployed.txExecutionResultName + " (nothing written)");
}
console.log("Contract:", contract);

// A finalized deploy can still be unusable, so prove the contract answers.
const summary = JSON.parse(await client.readContract({ address: contract, functionName: "get_summary", args: [] }));
console.log(`get_summary: ${summary.submission_count} submissions, params ${JSON.stringify(summary.params)}`);

const out = {
  network: "studionet",
  chainId: 61999,
  rpc: RPC_URL,
  deployer: account.address,
  deployTx,
  deployFinalized: finalized,
  deployStatus: deployed.statusName,
  deployResult: deployed.result_name,
  deployExecution: deployed.txExecutionResultName,
  contractAddress: contract,
  explorer: `https://explorer-studio.genlayer.com/address/${contract}`,
  constructorArgs: { faithful_score: ARGS[0], distorted_score: ARGS[1], score_band: ARGS[2] },
  params: summary.params,
  verified: true,
};
await writeFile(path.join(ROOT, "deployment.json"), JSON.stringify(out, null, 2) + "\n");
console.log("Wrote deployment.json");
