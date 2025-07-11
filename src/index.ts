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
// Secure logger configuration that prevents sensitive data leakage
const logger = winston.createLogger({
    level: process.env.NODE_ENV === "production" ? "error" : "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf((info) => {
            // Additional sanitization to prevent credential leakage
            const sanitized = JSON.stringify(info, (key, value) => {
                // Filter out sensitive keys
                if (
                    typeof key === "string" &&
                    (key.toLowerCase().includes("password") ||
                        key.toLowerCase().includes("token") ||
                        key.toLowerCase().includes("secret") ||
                        key.toLowerCase().includes("auth") ||
                        key.toLowerCase().includes("credential"))
                ) {
                    return "[REDACTED]";
                }
                return value;
            });
            return sanitized;
        })
    ),
    transports: [
        new winston.transports.File({
            filename: "bitbucket-errors.log",
            level: "error",
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: "bitbucket.log",
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
    // Prevent unhandled errors from crashing the application
    exitOnError: false,
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

    // Common schema snippets to reduce duplication
    private static readonly REPO_SLUG_SCHEMA = {
        type: "string" as const,
        description: "Repository slug",
    };

    private static readonly WORKSPACE_SCHEMA = {
        type: "string" as const,
        description: "Bitbucket workspace name",
    };

    private static readonly PULL_REQUEST_ID_SCHEMA = {
        type: "string" as const,
        description: "Pull request ID",
    };

    private static readonly PROJECT_KEY_SCHEMA = {
        type: "string" as const,
        description: "Project key",
    };

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
            baseUrl:
                process.env.BITBUCKET_URL ?? "https://api.bitbucket.org/2.0",
            token: process.env.BITBUCKET_TOKEN,
            username: process.env.BITBUCKET_USERNAME,
            password: process.env.BITBUCKET_PASSWORD,
            defaultWorkspace: process.env.BITBUCKET_WORKSPACE,
        };

        // Log configuration (sanitized - no sensitive data)
        logger.info("Bitbucket MCP Configuration", {
            baseUrl: this.config.baseUrl,
            hasToken: !!this.config.token,
            hasUsername: !!this.config.username,
            hasPassword: !!this.config.password,
            defaultWorkspace: this.config.defaultWorkspace,
        });

        // Validate required config
        if (!this.config.baseUrl) {
            throw new Error("BITBUCKET_URL is required");
        }

        if (
            !this.config.token &&
            !(this.config.username && this.config.password)
        ) {
            throw new Error(
                "Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required"
            );
        }

        // Setup Axios instance with proper authentication
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "bitbucket-mcp/4.1.0",
        };

        if (this.config.token) {
            // Use Bearer token authentication
            headers["Authorization"] = `Bearer ${this.config.token}`;
        }

        this.api = axios.create({
            baseURL: this.config.baseUrl,
            headers,
            auth:
                this.config.username &&
                this.config.password &&
                !this.config.token
                    ? {
                          username: this.config.username,
                          password: this.config.password,
                      }
                    : undefined,
            timeout: 30000, // 30 second timeout
        });

        // Add request interceptor for debugging (sanitized)
        this.api.interceptors.request.use(
            (config) => {
                // Sanitize logging to avoid credential exposure
                const sanitizedConfig = {
                    method: config.method,
                    url: config.url,
                    baseURL: config.baseURL,
                    hasAuth: !!(config.auth || config.headers?.Authorization),
                    // Never log actual auth data
                };
                logger.info("Making API request", sanitizedConfig);
                return config;
            },
            (error) => {
                logger.error(
                    "Request interceptor error",
                    this.sanitizeError(error)
                );
                return Promise.reject(error);
            }
        );

        // Add response interceptor for error handling (sanitized)
        this.api.interceptors.response.use(
            (response) => {
                logger.info("API response received", {
                    status: response.status,
                    url: response.config.url,
                    // Never log response data that might contain sensitive info
                });
                return response;
            },
            (error) => {
                const sanitizedError = this.sanitizeError(error);
                logger.error("API response error", sanitizedError);

                // Handle specific authentication errors
                if (error.response?.status === 401) {
                    logger.error("Authentication failed - check credentials");
                } else if (error.response?.status === 403) {
                    logger.error("Access forbidden - check permissions");
                }
                return Promise.reject(error);
            }
        );

        // Setup tool handlers using the request handler pattern
        this.setupToolHandlers();

        // Add error handler - CRITICAL for stability
        this.server.onerror = (error) =>
            logger.error("[MCP Error]", this.sanitizeError(error));
    }

    /**
     * Sanitize error objects to prevent credential leakage in logs
     */
    private sanitizeError(error: any): any {
        if (!error) return error;

        const sanitized: any = {
            message: error.message,
            name: error.name,
            code: error.code,
        };

        // Handle axios errors specifically
        if (error.response) {
            sanitized.response = {
                status: error.response.status,
                statusText: error.response.statusText,
                // Never log response data that might contain sensitive info
                hasData: !!error.response.data,
            };
        }

        if (error.request) {
            sanitized.request = {
                method: error.request.method,
                url: error.request.url,
                // Never log request data that might contain auth headers
                hasHeaders: !!error.request.headers,
            };
        }

        if (error.config) {
            sanitized.config = {
                method: error.config.method,
                url: error.config.url,
                baseURL: error.config.baseURL,
                hasAuth: !!(
                    error.config.auth || error.config.headers?.Authorization
                ),
                // Never log actual config data
            };
        }

        return sanitized;
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
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            limit: {
                                type: "number",
                                description:
                                    "Maximum number of repositories to return",
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
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
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
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            state: {
                                type: "string",
                                enum: [
                                    "OPEN",
                                    "MERGED",
                                    "DECLINED",
                                    "SUPERSEDED",
                                ],
                                description: "Pull request state",
                            },
                            limit: {
                                type: "number",
                                description:
                                    "Maximum number of pull requests to return",
                            },
                        },
                        required: ["workspace", "repo_slug"],
                    },
                },
                {
                    name: "createPullRequest",
                    description: "Create a new pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            title: {
                                type: "string",
                                description: "Pull request title",
                            },
                            description: {
                                type: "string",
                                description: "Pull request description",
                            },
                            sourceBranch: {
                                type: "string",
                                description: "Source branch name",
                            },
                            targetBranch: {
                                type: "string",
                                description: "Target branch name",
                            },
                            reviewers: {
                                type: "array",
                                items: { type: "string" },
                                description: "List of reviewer usernames",
                            },
                        },
                        required: [
                            "workspace",
                            "repo_slug",
                            "title",
                            "description",
                            "sourceBranch",
                            "targetBranch",
                        ],
                    },
                },
                {
                    name: "getPullRequest",
                    description: "Get details for a specific pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "updatePullRequest",
                    description: "Update a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                            title: {
                                type: "string",
                                description: "New pull request title",
                            },
                            description: {
                                type: "string",
                                description: "New pull request description",
                            },
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "getPullRequestActivity",
                    description: "Get activity log for a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "approvePullRequest",
                    description: "Approve a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "unapprovePullRequest",
                    description: "Remove approval from a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "declinePullRequest",
                    description: "Decline a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                            message: {
                                type: "string",
                                description: "Reason for declining",
                            },
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "mergePullRequest",
                    description: "Merge a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                            message: {
                                type: "string",
                                description: "Merge commit message",
                            },
                            strategy: {
                                type: "string",
                                enum: [
                                    "merge-commit",
                                    "squash",
                                    "fast-forward",
                                ],
                                description: "Merge strategy",
                            },
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "getPullRequestComments",
                    description: "List comments on a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "getPullRequestDiff",
                    description: "Get diff for a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "getPullRequestCommits",
                    description: "Get commits on a pull request",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            pull_request_id:
                                BitbucketServer.PULL_REQUEST_ID_SCHEMA,
                        },
                        required: ["workspace", "repo_slug", "pull_request_id"],
                    },
                },
                {
                    name: "getRepositoryBranchingModel",
                    description: "Get the branching model for a repository",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                        },
                        required: ["workspace", "repo_slug"],
                    },
                },
                {
                    name: "getRepositoryBranchingModelSettings",
                    description:
                        "Get the branching model config for a repository",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                        },
                        required: ["workspace", "repo_slug"],
                    },
                },
                {
                    name: "updateRepositoryBranchingModelSettings",
                    description:
                        "Update the branching model config for a repository",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                            development: {
                                type: "object",
                                description: "Development branch settings",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Branch name",
                                    },
                                    use_mainbranch: {
                                        type: "boolean",
                                        description: "Use main branch",
                                    },
                                },
                            },
                            production: {
                                type: "object",
                                description: "Production branch settings",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Branch name",
                                    },
                                    use_mainbranch: {
                                        type: "boolean",
                                        description: "Use main branch",
                                    },
                                    enabled: {
                                        type: "boolean",
                                        description: "Enable production branch",
                                    },
                                },
                            },
                            branch_types: {
                                type: "array",
                                description: "Branch types configuration",
                                items: {
                                    type: "object",
                                    properties: {
                                        kind: {
                                            type: "string",
                                            description:
                                                "Branch type kind (e.g., bugfix, feature)",
                                        },
                                        prefix: {
                                            type: "string",
                                            description: "Branch prefix",
                                        },
                                        enabled: {
                                            type: "boolean",
                                            description:
                                                "Enable this branch type",
                                        },
                                    },
                                    required: ["kind"],
                                },
                            },
                        },
                        required: ["workspace", "repo_slug"],
                    },
                },
                {
                    name: "getEffectiveRepositoryBranchingModel",
                    description:
                        "Get the effective branching model for a repository",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            repo_slug: BitbucketServer.REPO_SLUG_SCHEMA,
                        },
                        required: ["workspace", "repo_slug"],
                    },
                },
                {
                    name: "getProjectBranchingModel",
                    description: "Get the branching model for a project",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            project_key: BitbucketServer.PROJECT_KEY_SCHEMA,
                        },
                        required: ["workspace", "project_key"],
                    },
                },
                {
                    name: "getProjectBranchingModelSettings",
                    description: "Get the branching model config for a project",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            project_key: BitbucketServer.PROJECT_KEY_SCHEMA,
                        },
                        required: ["workspace", "project_key"],
                    },
                },
                {
                    name: "updateProjectBranchingModelSettings",
                    description:
                        "Update the branching model config for a project",
                    inputSchema: {
                        type: "object",
                        properties: {
                            workspace: BitbucketServer.WORKSPACE_SCHEMA,
                            project_key: BitbucketServer.PROJECT_KEY_SCHEMA,
                            development: {
                                type: "object",
                                description: "Development branch settings",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Branch name",
                                    },
                                    use_mainbranch: {
                                        type: "boolean",
                                        description: "Use main branch",
                                    },
                                },
                            },
                            production: {
                                type: "object",
                                description: "Production branch settings",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Branch name",
                                    },
                                    use_mainbranch: {
                                        type: "boolean",
                                        description: "Use main branch",
                                    },
                                    enabled: {
                                        type: "boolean",
                                        description: "Enable production branch",
                                    },
                                },
                            },
                            branch_types: {
                                type: "array",
                                description: "Branch types configuration",
                                items: {
                                    type: "object",
                                    properties: {
                                        kind: {
                                            type: "string",
                                            description:
                                                "Branch type kind (e.g., bugfix, feature)",
                                        },
                                        prefix: {
                                            type: "string",
                                            description: "Branch prefix",
                                        },
                                        enabled: {
                                            type: "boolean",
                                            description:
                                                "Enable this branch type",
                                        },
                                    },
                                    required: ["kind"],
                                },
                            },
                        },
                        required: ["workspace", "project_key"],
                    },
                },
            ],
        }));

        // Register the call tool handler
        this.server.setRequestHandler(
            CallToolRequestSchema,
            async (request) => {
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
                                args.state as
                                    | "OPEN"
                                    | "MERGED"
                                    | "DECLINED"
                                    | "SUPERSEDED",
                                args.limit as number
                            );
                        case "createPullRequest":
                            return await this.createPullRequest(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.title as string,
                                args.description as string,
                                args.sourceBranch as string,
                                args.targetBranch as string,
                                args.reviewers as string[]
                            );
                        case "getPullRequest":
                            return await this.getPullRequest(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string
                            );
                        case "updatePullRequest":
                            return await this.updatePullRequest(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string,
                                args.title as string,
                                args.description as string
                            );
                        case "getPullRequestActivity":
                            return await this.getPullRequestActivity(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string
                            );
                        case "approvePullRequest":
                            return await this.approvePullRequest(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string
                            );
                        case "unapprovePullRequest":
                            return await this.unapprovePullRequest(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string
                            );
                        case "declinePullRequest":
                            return await this.declinePullRequest(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string,
                                args.message as string
                            );
                        case "mergePullRequest":
                            return await this.mergePullRequest(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string,
                                args.message as string,
                                args.strategy as
                                    | "merge-commit"
                                    | "squash"
                                    | "fast-forward"
                            );
                        case "getPullRequestComments":
                            return await this.getPullRequestComments(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string
                            );
                        case "getPullRequestDiff":
                            return await this.getPullRequestDiff(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string
                            );
                        case "getPullRequestCommits":
                            return await this.getPullRequestCommits(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.pull_request_id as string
                            );
                        case "getRepositoryBranchingModel":
                            return await this.getRepositoryBranchingModel(
                                args.workspace as string,
                                args.repo_slug as string
                            );
                        case "getRepositoryBranchingModelSettings":
                            return await this.getRepositoryBranchingModelSettings(
                                args.workspace as string,
                                args.repo_slug as string
                            );
                        case "updateRepositoryBranchingModelSettings":
                            return await this.updateRepositoryBranchingModelSettings(
                                args.workspace as string,
                                args.repo_slug as string,
                                args.development as Record<string, any>,
                                args.production as Record<string, any>,
                                args.branch_types as Array<Record<string, any>>
                            );
                        case "getEffectiveRepositoryBranchingModel":
                            return await this.getEffectiveRepositoryBranchingModel(
                                args.workspace as string,
                                args.repo_slug as string
                            );
                        case "getProjectBranchingModel":
                            return await this.getProjectBranchingModel(
                                args.workspace as string,
                                args.project_key as string
                            );
                        case "getProjectBranchingModelSettings":
                            return await this.getProjectBranchingModelSettings(
                                args.workspace as string,
                                args.project_key as string
                            );
                        case "updateProjectBranchingModelSettings":
                            return await this.updateProjectBranchingModelSettings(
                                args.workspace as string,
                                args.project_key as string,
                                args.development as Record<string, any>,
                                args.production as Record<string, any>,
                                args.branch_types as Array<Record<string, any>>
                            );
                        default:
                            throw new McpError(
                                ErrorCode.MethodNotFound,
                                `Unknown tool: ${request.params.name}`
                            );
                    }
                } catch (error) {
                    logger.error(
                        "Tool execution error",
                        this.sanitizeError(error)
                    );
                    if (axios.isAxiosError(error)) {
                        // Never expose full error details that might contain sensitive data
                        const errorMessage =
                            error.response?.data?.error?.message ||
                            error.response?.data?.message ||
                            error.message ||
                            "Unknown API error";
                        throw new McpError(
                            ErrorCode.InternalError,
                            `Bitbucket API error: ${errorMessage}`
                        );
                    }
                    throw error;
                }
            }
        );
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
            logger.error("Error listing repositories", {
                error: this.sanitizeError(error),
                workspace: workspace,
            });
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
            logger.error("Error getting repository", {
                error,
                workspace,
                repo_slug,
            });
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

    async createPullRequest(
        workspace: string,
        repo_slug: string,
        title: string,
        description: string,
        sourceBranch: string,
        targetBranch: string,
        reviewers?: string[]
    ) {
        try {
            logger.info("Creating Bitbucket pull request", {
                workspace,
                repo_slug,
                title,
                sourceBranch,
                targetBranch,
            });

            // Prepare reviewers format if provided
            const reviewersArray =
                reviewers?.map((username) => ({
                    username,
                })) || [];

            // Create the pull request
            const response = await this.api.post(
                `/repositories/${workspace}/${repo_slug}/pullrequests`,
                {
                    title,
                    description,
                    source: {
                        branch: {
                            name: sourceBranch,
                        },
                    },
                    destination: {
                        branch: {
                            name: targetBranch,
                        },
                    },
                    reviewers: reviewersArray,
                    close_source_branch: true,
                }
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
            logger.error("Error creating pull request", {
                error,
                workspace,
                repo_slug,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to create pull request: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getPullRequest(
        workspace: string,
        repo_slug: string,
        pull_request_id: string
    ) {
        try {
            logger.info("Getting Bitbucket pull request details", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}`
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
            logger.error("Error getting pull request details", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get pull request details: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async updatePullRequest(
        workspace: string,
        repo_slug: string,
        pull_request_id: string,
        title?: string,
        description?: string
    ) {
        try {
            logger.info("Updating Bitbucket pull request", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            // Only include fields that are provided
            const updateData: Record<string, any> = {};
            if (title !== undefined) updateData.title = title;
            if (description !== undefined) updateData.description = description;

            const response = await this.api.put(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}`,
                updateData
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
            logger.error("Error updating pull request", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to update pull request: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getPullRequestActivity(
        workspace: string,
        repo_slug: string,
        pull_request_id: string
    ) {
        try {
            logger.info("Getting Bitbucket pull request activity", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/activity`
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
            logger.error("Error getting pull request activity", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get pull request activity: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async approvePullRequest(
        workspace: string,
        repo_slug: string,
        pull_request_id: string
    ) {
        try {
            logger.info("Approving Bitbucket pull request", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            const response = await this.api.post(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/approve`
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
            logger.error("Error approving pull request", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to approve pull request: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async unapprovePullRequest(
        workspace: string,
        repo_slug: string,
        pull_request_id: string
    ) {
        try {
            logger.info("Unapproving Bitbucket pull request", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            await this.api.delete(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/approve`
            );

            return {
                content: [
                    {
                        type: "text",
                        text: "Pull request approval removed successfully.",
                    },
                ],
            };
        } catch (error) {
            logger.error("Error unapproving pull request", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to unapprove pull request: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async declinePullRequest(
        workspace: string,
        repo_slug: string,
        pull_request_id: string,
        message?: string
    ) {
        try {
            logger.info("Declining Bitbucket pull request", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            // Include message if provided
            const data = message ? { message } : {};

            const response = await this.api.post(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/decline`,
                data
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
            logger.error("Error declining pull request", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to decline pull request: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async mergePullRequest(
        workspace: string,
        repo_slug: string,
        pull_request_id: string,
        message?: string,
        strategy?: "merge-commit" | "squash" | "fast-forward"
    ) {
        try {
            logger.info("Merging Bitbucket pull request", {
                workspace,
                repo_slug,
                pull_request_id,
                strategy,
            });

            // Build request data
            const data: Record<string, any> = {};
            if (message) data.message = message;
            if (strategy) data.merge_strategy = strategy;

            const response = await this.api.post(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/merge`,
                data
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
            logger.error("Error merging pull request", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to merge pull request: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getPullRequestComments(
        workspace: string,
        repo_slug: string,
        pull_request_id: string
    ) {
        try {
            logger.info("Getting Bitbucket pull request comments", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/comments`
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
            logger.error("Error getting pull request comments", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get pull request comments: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getPullRequestDiff(
        workspace: string,
        repo_slug: string,
        pull_request_id: string
    ) {
        try {
            logger.info("Getting Bitbucket pull request diff", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/diff`,
                {
                    headers: {
                        Accept: "text/plain",
                    },
                    responseType: "text",
                }
            );

            return {
                content: [
                    {
                        type: "text",
                        text: response.data,
                    },
                ],
            };
        } catch (error) {
            logger.error("Error getting pull request diff", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get pull request diff: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getPullRequestCommits(
        workspace: string,
        repo_slug: string,
        pull_request_id: string
    ) {
        try {
            logger.info("Getting Bitbucket pull request commits", {
                workspace,
                repo_slug,
                pull_request_id,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/commits`
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
            logger.error("Error getting pull request commits", {
                error,
                workspace,
                repo_slug,
                pull_request_id,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get pull request commits: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getRepositoryBranchingModel(workspace: string, repo_slug: string) {
        try {
            logger.info("Getting repository branching model", {
                workspace,
                repo_slug,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/branching-model`
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
            logger.error("Error getting repository branching model", {
                error,
                workspace,
                repo_slug,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get repository branching model: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getRepositoryBranchingModelSettings(
        workspace: string,
        repo_slug: string
    ) {
        try {
            logger.info("Getting repository branching model settings", {
                workspace,
                repo_slug,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/branching-model/settings`
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
            logger.error("Error getting repository branching model settings", {
                error,
                workspace,
                repo_slug,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get repository branching model settings: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async updateRepositoryBranchingModelSettings(
        workspace: string,
        repo_slug: string,
        development?: Record<string, any>,
        production?: Record<string, any>,
        branch_types?: Array<Record<string, any>>
    ) {
        try {
            logger.info("Updating repository branching model settings", {
                workspace,
                repo_slug,
                development,
                production,
                branch_types,
            });

            // Build request data with only the fields that are provided
            const updateData: Record<string, any> = {};
            if (development) updateData.development = development;
            if (production) updateData.production = production;
            if (branch_types) updateData.branch_types = branch_types;

            const response = await this.api.put(
                `/repositories/${workspace}/${repo_slug}/branching-model/settings`,
                updateData
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
            logger.error("Error updating repository branching model settings", {
                error,
                workspace,
                repo_slug,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to update repository branching model settings: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getEffectiveRepositoryBranchingModel(
        workspace: string,
        repo_slug: string
    ) {
        try {
            logger.info("Getting effective repository branching model", {
                workspace,
                repo_slug,
            });

            const response = await this.api.get(
                `/repositories/${workspace}/${repo_slug}/effective-branching-model`
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
            logger.error("Error getting effective repository branching model", {
                error,
                workspace,
                repo_slug,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get effective repository branching model: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getProjectBranchingModel(workspace: string, project_key: string) {
        try {
            logger.info("Getting project branching model", {
                workspace,
                project_key,
            });

            const response = await this.api.get(
                `/workspaces/${workspace}/projects/${project_key}/branching-model`
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
            logger.error("Error getting project branching model", {
                error,
                workspace,
                project_key,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get project branching model: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async getProjectBranchingModelSettings(
        workspace: string,
        project_key: string
    ) {
        try {
            logger.info("Getting project branching model settings", {
                workspace,
                project_key,
            });

            const response = await this.api.get(
                `/workspaces/${workspace}/projects/${project_key}/branching-model/settings`
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
            logger.error("Error getting project branching model settings", {
                error,
                workspace,
                project_key,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get project branching model settings: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async updateProjectBranchingModelSettings(
        workspace: string,
        project_key: string,
        development?: Record<string, any>,
        production?: Record<string, any>,
        branch_types?: Array<Record<string, any>>
    ) {
        try {
            logger.info("Updating project branching model settings", {
                workspace,
                project_key,
                development,
                production,
                branch_types,
            });

            // Build request data with only the fields that are provided
            const updateData: Record<string, any> = {};
            if (development) updateData.development = development;
            if (production) updateData.production = production;
            if (branch_types) updateData.branch_types = branch_types;

            const response = await this.api.put(
                `/workspaces/${workspace}/projects/${project_key}/branching-model/settings`,
                updateData
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
            logger.error("Error updating project branching model settings", {
                error,
                workspace,
                project_key,
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to update project branching model settings: ${
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
