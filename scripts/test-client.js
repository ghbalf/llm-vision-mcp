#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, env } from "node:process";

const [, , cmd, ...cmdArgs] = argv;
const serverCommand = cmd ?? "node";
const serverArgs = cmdArgs.length > 0 ? cmdArgs : ["dist/index.js"];

const TIMEOUT_MS = Number(env.MCP_CLIENT_TIMEOUT_MS ?? 300_000);

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(q);

function pickString(value) {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function promptDescribeImage() {
  const image = pickString(await ask("Image path/URL/base64: "));
  if (!image) throw new Error("image is required");
  const prompt = pickString(await ask("Prompt (blank for default): "));
  const provider = pickString(await ask("Provider (blank for default): "));
  const model = pickString(await ask("Model (blank for default): "));
  return {
    image,
    ...(prompt && { prompt }),
    ...(provider && { provider }),
    ...(model && { model }),
  };
}

async function promptDescribeImages() {
  const items = [];
  console.log("Enter batch items (blank image to finish):");
  while (true) {
    const image = pickString(await ask(`  item ${items.length + 1} image: `));
    if (!image) break;
    const prompt = pickString(await ask("    prompt (optional): "));
    const provider = pickString(await ask("    provider (optional): "));
    const model = pickString(await ask("    model (optional): "));
    items.push({
      image,
      ...(prompt && { prompt }),
      ...(provider && { provider }),
      ...(model && { model }),
    });
  }
  if (items.length === 0) throw new Error("at least one item required");

  const prompt = pickString(await ask("Batch default prompt (optional): "));
  const provider = pickString(await ask("Batch default provider (optional): "));
  const model = pickString(await ask("Batch default model (optional): "));
  const concurrency = pickString(await ask("Concurrency override (number, optional): "));
  return {
    items,
    ...(prompt && { prompt }),
    ...(provider && { provider }),
    ...(model && { model }),
    ...(concurrency && { concurrency: Number(concurrency) }),
  };
}

async function promptArgs(tool) {
  if (tool.name === "describe_image") return promptDescribeImage();
  if (tool.name === "describe_images") return promptDescribeImages();
  const raw = await ask(`Arguments for ${tool.name} (JSON): `);
  return raw.trim() === "" ? {} : JSON.parse(raw);
}

function renderResult(result) {
  console.log("\n=== Result ===");
  if (result.isError) console.log("[isError: true]");
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      console.log(block.text);
    } else {
      console.log(`[${block.type} block]`, JSON.stringify(block, null, 2));
    }
  }
}

async function renderTools(tools) {
  console.log("\nAvailable tools:");
  tools.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.name}${t.description ? ` — ${t.description}` : ""}`);
  });
}

async function main() {
  console.log(`Starting server: ${serverCommand} ${serverArgs.join(" ")}`);
  console.log(`Request timeout: ${TIMEOUT_MS} ms (set MCP_CLIENT_TIMEOUT_MS to override)`);
  const transport = new StdioClientTransport({
    command: serverCommand,
    args: serverArgs,
    env,
    stderr: "inherit",
  });
  const client = new Client({ name: "llm-vision-test-client", version: "0.1.0" });
  await client.connect(transport);
  console.log("Connected.");

  const { tools } = await client.listTools();
  if (tools.length === 0) {
    console.log("Server exposes no tools.");
    await client.close();
    rl.close();
    return;
  }
  await renderTools(tools);

  while (true) {
    const choice = (await ask("\nChoose tool # (or q to quit): ")).trim().toLowerCase();
    if (choice === "q" || choice === "quit") break;
    const idx = Number.parseInt(choice, 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= tools.length) {
      console.log("Invalid choice.");
      continue;
    }
    const tool = tools[idx];
    try {
      const args = await promptArgs(tool);
      console.log(`\nCalling ${tool.name}...`);
      const start = Date.now();
      const result = await client.callTool(
        { name: tool.name, arguments: args },
        undefined,
        { timeout: TIMEOUT_MS, resetTimeoutOnProgress: true },
      );
      const elapsed = Date.now() - start;
      renderResult(result);
      console.log(`\n(${elapsed} ms)`);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : String(err));
    }
  }

  await client.close();
  rl.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  rl.close();
  process.exit(1);
});
