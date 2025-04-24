#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  try {
    console.log("Creating MCP client...");
    const client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    console.log("Connecting to MCP server...");
    const transport = new StreamableHTTPClientTransport(
      new URL("http://localhost:3000/mcp")
    );

    await client.connect(transport);
    console.log("Connected to MCP server");

    console.log("Listing available tools...");
    const tools = await client.listTools();
    console.log("Available tools:");
    console.log(JSON.stringify(tools, null, 2));

    if (tools.tools.find((tool) => tool.name === "listRepositories")) {
      console.log("\nTesting listRepositories tool...");
      const result = await client.callTool({
        name: "listRepositories",
        arguments: {},
      });
      console.log("Result:");
      console.log(JSON.stringify(result, null, 2));
    }

    console.log("\nTest complete!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
