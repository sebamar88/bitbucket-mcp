# Bitbucket MCP

A Model Context Protocol (MCP) server for integrating with Bitbucket Cloud and Server APIs. This MCP server allows AI assistants to interact with Bitbucket repositories, pull requests, and other resources.

## Overview

This server implements the [Model Context Protocol](https://modelcontextprotocol.io/) standard to provide AI assistants with access to Bitbucket data and operations. It includes tools for:

- Listing and retrieving repositories
- Managing pull requests
- Working with repository content

## Getting Started

### Prerequisites

- Node.js 18 or higher
- A Bitbucket Cloud account or Bitbucket Server instance
- Optional: Bitbucket API token for authenticated requests

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/bitbucket-mcp.git
cd bitbucket-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration

Configure the server using environment variables:

```bash
# Bitbucket API token (optional, but recommended)
export BITBUCKET_TOKEN=your_token_here

# For custom Bitbucket Server installations
export BITBUCKET_API_URL=https://your-bitbucket-server.com/api
```

### Running the Server

```bash
# Start the server
npm start

# Or run in development mode
npm run dev

# Use standalone mode for direct stdio communication
npm run standalone
```

## Available Tools

This MCP server provides tools for interacting with Bitbucket repositories and pull requests. For a comprehensive list of all available tools with detailed documentation, please see [TOOLS.md](TOOLS.md).

Some of the available tools include:

- **listRepositories**: List repositories in a workspace
- **getRepository**: Get details for a specific repository
- **getPullRequests**: Get pull requests for a repository

## Integration with MCP Clients

This server can be integrated with any MCP client by connecting to the server endpoint:

- HTTP endpoint: `http://localhost:3000/mcp`
- When running in standalone mode, communication happens over stdio

## Development

### Project Structure

```
bitbucket-mcp/
├── src/
│   ├── api/       # API-related code
│   ├── services/  # Service implementations
│   ├── types/     # TypeScript type definitions
│   ├── utils/     # Utility functions
│   └── index.ts   # Entry point
├── package.json
└── tsconfig.json
```

### Adding New Tools

To add a new tool, modify the `src/index.ts` file and add your tool definition:

```typescript
const newTool = server.tool(
  "newToolName",
  {
    param1: z.string(),
    param2: z.number().optional(),
  },
  async ({ param1, param2 }) => {
    // Implementation goes here
    return {
      content: [{ type: "text", text: "Result" }],
    };
  }
);
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
