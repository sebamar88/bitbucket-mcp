#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import winston from "winston";

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

// =========== LOGGER SETUP ===========
/**
 * Sets up a Winston logger with console and file transports
 */
function setupLogger() {
  // Define transports array with the correct type
  const transports: winston.transport[] = [
    // File transport for errors
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
    }),
  ];

  // Only use stderr for console output when running in stdio mode to avoid conflicting with MCP transport
  // This prevents logger output from mixing with MCP messages on stdout
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      stderrLevels: ["error", "warn", "info", "debug", "silly"], // Redirect ALL console output to stderr
    })
  );

  return winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    defaultMeta: { service: "bitbucket-mcp" },
    transports,
  });
}

// Setup logger
const logger = setupLogger();

// =========== BITBUCKET API ===========
/**
 * BitbucketAPI class for interacting with Bitbucket Cloud REST API
 */
class BitbucketAPI {
  private axios: AxiosInstance;
  private baseUrl: string;
  private authenticated: boolean = false;

  /**
   * Creates an instance of BitbucketAPI
   * @param token Optional access token for authenticated requests
   * @param baseUrl Base URL for Bitbucket API, defaults to cloud API
   */
  constructor(
    token?: string,
    baseUrl: string = "https://api.bitbucket.org/2.0"
  ) {
    this.baseUrl = baseUrl;

    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          }
        : {
            "Content-Type": "application/json",
          },
    });

    this.authenticated = !!token;

    // Add response interceptor for logging
    this.axios.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error("Bitbucket API error", {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data,
          url: error.config?.url,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * List repositories for a workspace
   * @param workspace Bitbucket workspace name (optional)
   * @param limit Maximum number of repositories to return
   * @returns Array of repository objects
   */
  async listRepositories(
    workspace?: string,
    limit: number = 10
  ): Promise<BitbucketRepository[]> {
    try {
      // If workspace is specified, get repos for that workspace
      if (workspace) {
        const response = await this.axios.get(`/repositories/${workspace}`, {
          params: { limit },
        });
        return response.data.values;
      }

      // Without workspace, get all accessible repositories (requires auth)
      if (!this.authenticated) {
        throw new Error(
          "Authentication required to list repositories without specifying a workspace"
        );
      }

      const response = await this.axios.get("/repositories", {
        params: { limit },
      });
      return response.data.values;
    } catch (error) {
      logger.error("Error listing repositories", { error, workspace });
      throw error;
    }
  }

  /**
   * Get repository details
   * @param workspace Bitbucket workspace name
   * @param repo_slug Repository slug
   * @returns Repository object
   */
  async getRepository(
    workspace: string,
    repo_slug: string
  ): Promise<BitbucketRepository> {
    try {
      const response = await this.axios.get(
        `/repositories/${workspace}/${repo_slug}`
      );
      return response.data;
    } catch (error) {
      logger.error("Error getting repository", { error, workspace, repo_slug });
      throw error;
    }
  }

  /**
   * Get pull requests for a repository
   * @param workspace Bitbucket workspace name
   * @param repo_slug Repository slug
   * @param state Filter by pull request state
   * @param limit Maximum number of pull requests to return
   * @returns Array of pull request objects
   */
  async getPullRequests(
    workspace: string,
    repo_slug: string,
    state?: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED",
    limit: number = 10
  ): Promise<BitbucketPullRequest[]> {
    try {
      const response = await this.axios.get(
        `/repositories/${workspace}/${repo_slug}/pullrequests`,
        {
          params: {
            state: state,
            limit,
          },
        }
      );
      return response.data.values;
    } catch (error) {
      logger.error("Error getting pull requests", {
        error,
        workspace,
        repo_slug,
      });
      throw error;
    }
  }
}

/**
 * Factory function to get a BitbucketAPI instance
 * Uses environment variables for configuration if available
 */
async function getBitbucketAPI(): Promise<BitbucketAPI> {
  const token = process.env.BITBUCKET_TOKEN;
  const baseUrl =
    process.env.BITBUCKET_API_URL || "https://api.bitbucket.org/2.0";

  return new BitbucketAPI(token, baseUrl);
}

// =========== MCP SERVER ===========
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

// =========== MAIN ===========
// Create and run the Bitbucket MCP Server instance
const bitbucketMcpServer = new BitbucketMcpServer();

// Start the server using the run method
bitbucketMcpServer.run().catch((error) => {
  logger.error("Failed to run Bitbucket MCP server", { error });
  process.exit(1);
});
