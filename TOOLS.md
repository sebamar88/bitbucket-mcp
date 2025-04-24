# Bitbucket MCP Tools

This document provides a comprehensive list of all tools available in the Bitbucket MCP server.

## Repository Tools

### listRepositories

Lists repositories in a Bitbucket workspace.

**Parameters:**

- `workspace` (string, optional): The Bitbucket workspace name to list repositories from. If not provided, lists repositories from all accessible workspaces.
- `limit` (number, optional): Maximum number of repositories to return.

**Example:**

```json
{
  "name": "listRepositories",
  "arguments": {
    "workspace": "my-workspace",
    "limit": 10
  }
}
```

**Returns:**
A list of repositories with basic information including name, full name, description, and links.

### getRepository

Gets detailed information about a specific repository.

**Parameters:**

- `workspace` (string, required): The Bitbucket workspace name.
- `repo_slug` (string, required): The repository slug (URL-friendly name).

**Example:**

```json
{
  "name": "getRepository",
  "arguments": {
    "workspace": "my-workspace",
    "repo_slug": "my-repository"
  }
}
```

**Returns:**
Detailed information about the specified repository including its name, description, clone URLs, and other metadata.

## Pull Request Tools

### getPullRequests

Lists pull requests for a specific repository.

**Parameters:**

- `workspace` (string, required): The Bitbucket workspace name.
- `repo_slug` (string, required): The repository slug (URL-friendly name).
- `state` (string, optional): Filter by pull request state. Valid values: "OPEN", "MERGED", "DECLINED", "SUPERSEDED".
- `limit` (number, optional): Maximum number of pull requests to return.

**Example:**

```json
{
  "name": "getPullRequests",
  "arguments": {
    "workspace": "my-workspace",
    "repo_slug": "my-repository",
    "state": "OPEN",
    "limit": 5
  }
}
```

**Returns:**
A list of pull requests matching the specified criteria, including title, description, source and destination branches, and reviewers.

## Using Tools with MCP Clients

### Programmatic Usage

```javascript
const result = await client.callTool({
  name: "listRepositories",
  arguments: {
    workspace: "my-workspace",
    limit: 10,
  },
});
```

### MCP JSON-RPC Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "mcp.call_tool",
  "params": {
    "name": "getRepository",
    "arguments": {
      "workspace": "my-workspace",
      "repo_slug": "my-repository"
    }
  }
}
```

## Listing Available Tools

You can programmatically list all available tools by calling the `listTools` method on your MCP client:

```javascript
const tools = await client.listTools();
console.log(tools);
```

Or using the test client script provided in this repository:

```bash
node test-client.js
```
