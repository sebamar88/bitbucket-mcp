# Bitbucket MCP

A Model Context Protocol (MCP) server for integrating with Bitbucket Cloud and Server APIs. This MCP server enables AI assistants like Cursor to interact with your Bitbucket repositories, pull requests, and other resources.

[![GitHub Repository](https://img.shields.io/badge/GitHub-Repository-blue.svg)](https://github.com/MatanYemini/bitbucket-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/bitbucket-mcp.svg)](https://www.npmjs.com/package/bitbucket-mcp)

## Overview

This server implements the Model Context Protocol standard to provide AI assistants with access to Bitbucket data and operations. It includes tools for:

- Listing and retrieving repositories
- Getting repository details
- Fetching pull requests
- And more...

## Installation

### Using NPX (Recommended)

The easiest way to use this MCP server is via NPX, which allows you to run it without installing it globally:

```bash
# Run with environment variables
BITBUCKET_URL="https://bitbucket.org/your-workspace" \
BITBUCKET_USERNAME="your-username" \
BITBUCKET_PASSWORD="your-app-password" \
npx -y bitbucket-mcp@latest
```

### Manual Installation

Alternatively, you can install it globally or as part of your project:

```bash
# Install globally
npm install -g bitbucket-mcp

# Or install in your project
npm install bitbucket-mcp
```

Then run it with:

```bash
# If installed globally
BITBUCKET_URL="https://bitbucket.org/your-workspace" \
BITBUCKET_USERNAME="your-username" \
BITBUCKET_PASSWORD="your-app-password" \
bitbucket-mcp

# If installed in your project
BITBUCKET_URL="https://bitbucket.org/your-workspace" \
BITBUCKET_USERNAME="your-username" \
BITBUCKET_PASSWORD="your-app-password" \
npx bitbucket-mcp
```

## Configuration

### Environment Variables

Configure the server using the following environment variables:

| Variable              | Description                                                       | Required |
| --------------------- | ----------------------------------------------------------------- | -------- |
| `BITBUCKET_URL`       | Bitbucket base URL (e.g., "https://bitbucket.org/your-workspace") | Yes      |
| `BITBUCKET_USERNAME`  | Your Bitbucket username                                           | Yes\*    |
| `BITBUCKET_PASSWORD`  | Your Bitbucket app password                                       | Yes\*    |
| `BITBUCKET_TOKEN`     | Your Bitbucket access token (alternative to username/password)    | No       |
| `BITBUCKET_WORKSPACE` | Default workspace to use when not specified                       | No       |

\* Either `BITBUCKET_TOKEN` or both `BITBUCKET_USERNAME` and `BITBUCKET_PASSWORD` must be provided.

### Creating a Bitbucket App Password

1. Log in to your Bitbucket account
2. Go to Personal Settings > App Passwords
3. Create a new app password with the following permissions:
   - Repositories: Read
   - Pull requests: Read, Write
4. Copy the generated password and use it as the `BITBUCKET_PASSWORD` environment variable

## Integration with Cursor

To integrate this MCP server with Cursor:

1. Open Cursor
2. Go to Settings > Extensions
3. Click on "Model Context Protocol"
4. Add a new MCP configuration:

```json
"bitbucket": {
  "command": "npx",
  "env": {
    "BITBUCKET_URL": "https://bitbucket.org/your-workspace",
    "BITBUCKET_USERNAME": "your-username",
    "BITBUCKET_PASSWORD": "your-app-password"
  },
  "args": ["-y", "bitbucket-mcp@latest"]
}
```

5. Save the configuration
6. Use the "/bitbucket" command in Cursor to access Bitbucket repositories and pull requests

### Using a Local Build with Cursor

If you're developing locally and want to test your changes:

```json
"bitbucket-local": {
  "command": "node",
  "env": {
    "BITBUCKET_URL": "https://bitbucket.org/your-workspace",
    "BITBUCKET_USERNAME": "your-username",
    "BITBUCKET_PASSWORD": "your-app-password"
  },
  "args": ["/path/to/your/local/bitbucket-mcp/dist/index.js"]
}
```

## Available Tools

This MCP server provides the following tools:

### `listRepositories`

Lists repositories in a workspace.

**Parameters:**

- `workspace` (optional): Bitbucket workspace name
- `limit` (optional): Maximum number of repositories to return

### `getRepository`

Gets details for a specific repository.

**Parameters:**

- `workspace`: Bitbucket workspace name
- `repo_slug`: Repository slug

### `getPullRequests`

Gets pull requests for a repository.

**Parameters:**

- `workspace`: Bitbucket workspace name
- `repo_slug`: Repository slug
- `state` (optional): Pull request state (`OPEN`, `MERGED`, `DECLINED`, `SUPERSEDED`)
- `limit` (optional): Maximum number of pull requests to return

## Development

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/MatanYemini/bitbucket-mcp.git
cd bitbucket-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- [GitHub Repository](https://github.com/MatanYemini/bitbucket-mcp)
- [npm Package](https://www.npmjs.com/package/bitbucket-mcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
