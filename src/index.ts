#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// Import modular components
import { createBitbucketConfig, validateConfig } from "./config/bitbucket.js";
import { logger, sanitizeError } from "./utils/logger.js";
import { RepositoryService } from "./services/repository.js";
import { PullRequestService } from "./services/pullrequest.js";
import { BranchingModelService } from "./services/branchingmodel.js";
import { TOOL_DEFINITIONS } from "./schemas/tools.js";
import { ToolHandlerMap, BitbucketConfig } from "./types/index.js";

/**
 * Modular Bitbucket MCP Server
 * 
 * This server has been refactored from a monolithic structure to improve
 * maintainability, readability, and testability. Key improvements:
 * 
 * - Separated concerns into dedicated service classes
 * - Extracted configuration and logging utilities
 * - Centralized tool definitions and schemas
 * - Improved error handling and security
 */
class BitbucketServer {
    private readonly server: Server;
    private readonly config: BitbucketConfig;
    private readonly toolHandlers: ToolHandlerMap;
    
    // Service instances
    private readonly repositoryService: RepositoryService;
    private readonly pullRequestService: PullRequestService;
    private readonly branchingModelService: BranchingModelService;

    constructor() {
        // Initialize MCP server
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

        // Load and validate configuration
        this.config = createBitbucketConfig();
        validateConfig(this.config);

        // Log configuration (sanitized - no sensitive data)
        logger.info("Bitbucket MCP Configuration", {
            baseUrl: this.config.baseUrl,
            hasToken: !!this.config.token,
            hasUsername: !!this.config.username,
            hasPassword: !!this.config.password,
            defaultWorkspace: this.config.defaultWorkspace,
        });

        // Initialize services
        this.repositoryService = new RepositoryService(this.config);
        this.pullRequestService = new PullRequestService(this.config);
        this.branchingModelService = new BranchingModelService(this.config);

        // Initialize tool handlers
        this.toolHandlers = this.initializeToolHandlers();

        // Setup MCP handlers
        this.setupToolHandlers();
    }

    /**
     * Initialize tool handlers map to reduce switch statement complexity
     */
    private initializeToolHandlers(): ToolHandlerMap {
        return {
            // Repository operations
            listRepositories: async (args) =>
                this.repositoryService.listRepositories(
                    args.workspace as string,
                    args.limit as number
                ),

            getRepository: async (args) =>
                this.repositoryService.getRepository(
                    args.workspace as string,
                    args.repo_slug as string
                ),

            // Pull request operations
            getPullRequests: async (args) =>
                this.pullRequestService.getPullRequests(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.state as "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED",
                    args.limit as number
                ),

            createPullRequest: async (args) =>
                this.pullRequestService.createPullRequest(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.title as string,
                    args.description as string,
                    args.sourceBranch as string,
                    args.targetBranch as string,
                    args.reviewers as string[]
                ),

            getPullRequest: async (args) =>
                this.pullRequestService.getPullRequest(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string
                ),

            updatePullRequest: async (args) =>
                this.pullRequestService.updatePullRequest(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string,
                    args.title as string,
                    args.description as string
                ),

            getPullRequestActivity: async (args) =>
                this.pullRequestService.getPullRequestActivity(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string
                ),

            approvePullRequest: async (args) =>
                this.pullRequestService.approvePullRequest(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string
                ),

            unapprovePullRequest: async (args) =>
                this.pullRequestService.unapprovePullRequest(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string
                ),

            declinePullRequest: async (args) =>
                this.pullRequestService.declinePullRequest(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string,
                    args.message as string
                ),

            mergePullRequest: async (args) =>
                this.pullRequestService.mergePullRequest(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string,
                    args.message as string,
                    args.strategy as "merge-commit" | "squash" | "fast-forward"
                ),

            getPullRequestComments: async (args) =>
                this.pullRequestService.getPullRequestComments(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string
                ),

            getPullRequestDiff: async (args) =>
                this.pullRequestService.getPullRequestDiff(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string
                ),

            getPullRequestCommits: async (args) =>
                this.pullRequestService.getPullRequestCommits(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.pull_request_id as string
                ),

            // Branching model operations
            getRepositoryBranchingModel: async (args) =>
                this.branchingModelService.getRepositoryBranchingModel(
                    args.workspace as string,
                    args.repo_slug as string
                ),

            getRepositoryBranchingModelSettings: async (args) =>
                this.branchingModelService.getRepositoryBranchingModelSettings(
                    args.workspace as string,
                    args.repo_slug as string
                ),

            updateRepositoryBranchingModelSettings: async (args) =>
                this.branchingModelService.updateRepositoryBranchingModelSettings(
                    args.workspace as string,
                    args.repo_slug as string,
                    args.development as Record<string, any>,
                    args.production as Record<string, any>,
                    args.branch_types as Array<Record<string, any>>
                ),

            getEffectiveRepositoryBranchingModel: async (args) =>
                this.branchingModelService.getEffectiveRepositoryBranchingModel(
                    args.workspace as string,
                    args.repo_slug as string
                ),

            getProjectBranchingModel: async (args) =>
                this.branchingModelService.getProjectBranchingModel(
                    args.workspace as string,
                    args.project_key as string
                ),

            getProjectBranchingModelSettings: async (args) =>
                this.branchingModelService.getProjectBranchingModelSettings(
                    args.workspace as string,
                    args.project_key as string
                ),

            updateProjectBranchingModelSettings: async (args) =>
                this.branchingModelService.updateProjectBranchingModelSettings(
                    args.workspace as string,
                    args.project_key as string,
                    args.development as Record<string, any>,
                    args.production as Record<string, any>,
                    args.branch_types as Array<Record<string, any>>
                ),
        };
    }

    private setupToolHandlers() {
        // Register the list tools handler
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: TOOL_DEFINITIONS,
        }));

        // Register the call tool handler
        this.server.setRequestHandler(
            CallToolRequestSchema,
            async (request) => {
                const { name, arguments: args } = request.params;

                try {
                    const handler = this.toolHandlers[name];
                    if (!handler) {
                        throw new McpError(
                            ErrorCode.MethodNotFound,
                            `Unknown tool: ${name}`
                        );
                    }

                    return await handler(args ?? {});
                } catch (error) {
                    logger.error(
                        "Tool execution error",
                        sanitizeError(error)
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

// Export for testing
export { BitbucketServer };
