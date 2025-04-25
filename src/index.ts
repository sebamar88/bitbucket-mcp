#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import winston from "winston";

// =========== LOGGER SETUP ===========
// Simple logger that only writes to a file (no stdout pollution)
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "bitbucket.log" })],
});

// =========== TYPE DEFINITIONS ===========
/**
 * Represents a Bitbucket repository
 */
interface BitbucketRepository {
  uuid: string;
  name: string;
  full_name: string;
  description: string;
  is_private: boolean;
  created_on: string;
  updated_on: string;
  size: number;
  language: string;
  has_issues: boolean;
  has_wiki: boolean;
  fork_policy: string;
  owner: BitbucketAccount;
  workspace: BitbucketWorkspace;
  project: BitbucketProject;
  mainbranch?: BitbucketBranch;
  website?: string;
  scm: string;
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket account (user or team)
 */
interface BitbucketAccount {
  uuid: string;
  display_name: string;
  account_id: string;
  nickname?: string;
  type: "user" | "team";
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket workspace
 */
interface BitbucketWorkspace {
  uuid: string;
  name: string;
  slug: string;
  type: "workspace";
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket project
 */
interface BitbucketProject {
  uuid: string;
  key: string;
  name: string;
  description?: string;
  is_private: boolean;
  type: "project";
  links: Record<string, BitbucketLink[]>;
}

/**
 * Represents a Bitbucket branch reference
 */
interface BitbucketBranch {
  name: string;
  type: "branch";
}

/**
 * Represents a hyperlink in Bitbucket API responses
 */
interface BitbucketLink {
  href: string;
  name?: string;
}

/**
 * Represents a Bitbucket pull request
 */
interface BitbucketPullRequest {
  id: number;
  title: string;
  description: string;
  state: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  author: BitbucketAccount;
  source: BitbucketBranchReference;
  destination: BitbucketBranchReference;
  created_on: string;
  updated_on: string;
  closed_on?: string;
  comment_count: number;
  task_count: number;
  close_source_branch: boolean;
  reviewers: BitbucketAccount[];
  participants: BitbucketParticipant[];
  links: Record<string, BitbucketLink[]>;
  summary?: {
    raw: string;
    markup: string;
    html: string;
  };
}

/**
 * Represents a branch reference in a pull request
 */
interface BitbucketBranchReference {
  branch: {
    name: string;
  };
  commit: {
    hash: string;
  };
  repository: BitbucketRepository;
}

/**
 * Represents a participant in a pull request
 */
interface BitbucketParticipant {
  user: BitbucketAccount;
  role: "PARTICIPANT" | "REVIEWER";
  approved: boolean;
  state?: "approved" | "changes_requested" | null;
  participated_on: string;
}

interface BitbucketConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  defaultWorkspace?: string;
}

// =========== MCP SERVER ===========
class BitbucketServer {
  private readonly server: Server;
  private readonly api: AxiosInstance;
  private readonly config: BitbucketConfig;

  constructor() {
    // Initialize with the older Server class pattern
    this.server = new Server(
      {
        name: "bitbucket-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Configuration from environment variables
    this.config = {
      baseUrl: process.env.BITBUCKET_URL ?? "https://api.bitbucket.org/2.0",
      token: process.env.BITBUCKET_TOKEN,
      username: process.env.BITBUCKET_USERNAME,
      password: process.env.BITBUCKET_PASSWORD,
      defaultWorkspace: process.env.BITBUCKET_WORKSPACE,
    };

    // Validate required config
    if (!this.config.baseUrl) {
      throw new Error("BITBUCKET_URL is required");
    }

    if (!this.config.token && !(this.config.username && this.config.password)) {
      throw new Error(
        "Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required"
      );
    }

    // Setup Axios instance
    this.api = axios.create({
      baseURL: this.config.baseUrl,
      headers: this.config.token
        ? { Authorization: `Bearer ${this.config.token}` }
        : { "Content-Type": "application/json" },
      auth:
        this.config.username && this.config.password
          ? { username: this.config.username, password: this.config.password }
          : undefined,
    });

    // Setup tool handlers using the request handler pattern
    this.setupToolHandlers();

    // Add error handler - CRITICAL for stability
    this.server.onerror = (error) => logger.error("[MCP Error]", error);
  }

  private setupToolHandlers() {
    // Register the list tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "listRepositories",
          description: "List Bitbucket repositories",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Bitbucket workspace name",
              },
              limit: {
                type: "number",
                description: "Maximum number of repositories to return",
              },
            },
          },
        },
        {
          name: "getRepository",
          description: "Get repository details",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Bitbucket workspace name",
              },
              repo_slug: { type: "string", description: "Repository slug" },
            },
            required: ["workspace", "repo_slug"],
          },
        },
        {
          name: "getPullRequests",
          description: "Get pull requests for a repository",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Bitbucket workspace name",
              },
              repo_slug: { type: "string", description: "Repository slug" },
              state: {
                type: "string",
                enum: ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"],
                description: "Pull request state",
              },
              limit: {
                type: "number",
                description: "Maximum number of pull requests to return",
              },
            },
            required: ["workspace", "repo_slug"],
          },
        },
      ],
    }));

    // Register the call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        logger.info(`Called tool: ${request.params.name}`, {
          arguments: request.params.arguments,
        });
        const args = request.params.arguments ?? {};

        switch (request.params.name) {
          case "listRepositories":
            return await this.listRepositories(
              args.workspace as string,
              args.limit as number
            );
          case "getRepository":
            return await this.getRepository(
              args.workspace as string,
              args.repo_slug as string
            );
          case "getPullRequests":
            return await this.getPullRequests(
              args.workspace as string,
              args.repo_slug as string,
              args.state as "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED",
              args.limit as number
            );
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        logger.error("Tool execution error", { error });
        if (axios.isAxiosError(error)) {
          throw new McpError(
            ErrorCode.InternalError,
            `Bitbucket API error: ${
              error.response?.data.message ?? error.message
            }`
          );
        }
        throw error;
      }
    });
  }

  async listRepositories(workspace?: string, limit: number = 10) {
    try {
      // Use default workspace if not provided
      const wsName = workspace || this.config.defaultWorkspace;

      if (!wsName) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Workspace must be provided either as a parameter or through BITBUCKET_WORKSPACE environment variable"
        );
      }

      logger.info("Listing Bitbucket repositories", {
        workspace: wsName,
        limit,
      });

      const response = await this.api.get(`/repositories/${wsName}`, {
        params: { limit },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data.values, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error("Error listing repositories", { error, workspace });
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list repositories: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async getRepository(workspace: string, repo_slug: string) {
    try {
      logger.info("Getting Bitbucket repository info", {
        workspace,
        repo_slug,
      });

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}`
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error("Error getting repository", { error, workspace, repo_slug });
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get repository: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async getPullRequests(
    workspace: string,
    repo_slug: string,
    state?: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED",
    limit: number = 10
  ) {
    try {
      logger.info("Getting Bitbucket pull requests", {
        workspace,
        repo_slug,
        state,
        limit,
      });

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pullrequests`,
        {
          params: {
            state: state,
            limit,
          },
        }
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data.values, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error("Error getting pull requests", {
        error,
        workspace,
        repo_slug,
      });
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get pull requests: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("Bitbucket MCP server running on stdio");
  }
}

// Create and start the server
const server = new BitbucketServer();
server.run().catch((error) => {
  logger.error("Server error", error);
  process.exit(1);
});
