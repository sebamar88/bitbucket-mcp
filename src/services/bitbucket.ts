import axios, { AxiosInstance } from "axios";
import {
  BitbucketRepository,
  BitbucketPullRequest,
} from "../types/bitbucket.js";
import { setupLogger } from "../utils/logger.js";

const logger = setupLogger();

/**
 * BitbucketAPI class for interacting with Bitbucket Cloud REST API
 */
export class BitbucketAPI {
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
export async function getBitbucketAPI(): Promise<BitbucketAPI> {
  const token = process.env.BITBUCKET_TOKEN;
  const baseUrl =
    process.env.BITBUCKET_API_URL || "https://api.bitbucket.org/2.0";

  return new BitbucketAPI(token, baseUrl);
}
