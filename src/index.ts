#!/usr/bin/env node
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import { randomUUID } from "crypto";
import { setupLogger } from "./utils/logger.js";
import { getBitbucketAPI } from "./services/bitbucket.js";

// Setup logger
const logger = setupLogger();

// Bitbucket MCP Server class
class BitbucketMcpServer {
  private readonly server: McpServer;

  constructor() {
    // Initialize the MCP server
    this.server = new McpServer({
      name: "bitbucket-mcp",
      version: "1.0.0",
    });

    this.setupTools();
  }

  private setupTools() {
    // Register bitbucket repository tools
    this.server.tool(
      "listRepositories",
      {
        workspace: z.string().optional().describe("Bitbucket workspace name"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of repositories to return"),
      },
      async ({ workspace, limit }, extra) => {
        logger.info("Listing Bitbucket repositories", { workspace, limit });
        try {
          const bitbucketAPI = await getBitbucketAPI();
          const repositories = await bitbucketAPI.listRepositories(
            workspace,
            limit
          );
          return {
            content: [
              {
                type: "text",
                text: `Found ${repositories.length} repositories${
                  workspace ? ` in workspace ${workspace}` : ""
                }`,
              },
              {
                type: "text",
                text: JSON.stringify(repositories, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error("Error listing repositories", { error });
          return {
            content: [
              {
                type: "text",
                text: `Error listing repositories: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    this.server.tool(
      "getRepository",
      {
        workspace: z.string().describe("Bitbucket workspace name"),
        repo_slug: z.string().describe("Repository slug"),
      },
      async ({ workspace, repo_slug }, extra) => {
        logger.info("Getting Bitbucket repository info", {
          workspace,
          repo_slug,
        });
        try {
          const bitbucketAPI = await getBitbucketAPI();
          const repository = await bitbucketAPI.getRepository(
            workspace,
            repo_slug
          );
          return {
            content: [
              {
                type: "text",
                text: `Repository: ${repository.name}`,
              },
              {
                type: "text",
                text: JSON.stringify(repository, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error("Error getting repository", {
            error,
            workspace,
            repo_slug,
          });
          return {
            content: [
              {
                type: "text",
                text: `Error getting repository: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    this.server.tool(
      "getPullRequests",
      {
        workspace: z.string().describe("Bitbucket workspace name"),
        repo_slug: z.string().describe("Repository slug"),
        state: z
          .enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"])
          .optional()
          .describe("Pull request state"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of pull requests to return"),
      },
      async ({ workspace, repo_slug, state, limit }, extra) => {
        logger.info("Getting Bitbucket pull requests", {
          workspace,
          repo_slug,
          state,
          limit,
        });
        try {
          const bitbucketAPI = await getBitbucketAPI();
          const pullRequests = await bitbucketAPI.getPullRequests(
            workspace,
            repo_slug,
            state,
            limit
          );
          return {
            content: [
              {
                type: "text",
                text: `Found ${pullRequests.length} pull requests${
                  state ? ` with state ${state}` : ""
                }`,
              },
              {
                type: "text",
                text: JSON.stringify(pullRequests, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error("Error getting pull requests", {
            error,
            workspace,
            repo_slug,
          });
          return {
            content: [
              {
                type: "text",
                text: `Error getting pull requests: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );
  }

  // Method to run the server with StdioTransport
  public async run() {
    logger.info("Running Bitbucket MCP server with stdio transport");
    const stdioTransport = new StdioServerTransport();
    try {
      await this.server.connect(stdioTransport);
      logger.info("Bitbucket MCP server connected via stdio");
    } catch (error) {
      logger.error("Error connecting stdio transport", { error });
      process.exit(1);
    }
  }

  // Method to get the McpServer instance
  public getServer(): McpServer {
    return this.server;
  }
}

// Create and run the Bitbucket MCP Server instance
const bitbucketMcpServer = new BitbucketMcpServer();

// Start the server using the run method
bitbucketMcpServer.run().catch((error) => {
  logger.error("Failed to run Bitbucket MCP server", { error });
  process.exit(1);
});
