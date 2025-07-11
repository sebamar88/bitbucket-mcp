export interface BitbucketConfig {
    baseUrl: string;
    token?: string;
    username?: string;
    password?: string;
    defaultWorkspace?: string;
}

export type ToolHandler = (args: Record<string, any>) => Promise<any>;

export type ToolHandlerMap = {
    [key: string]: ToolHandler;
};

export interface McpResponse {
    content: Array<{
        type: "text";
        text: string;
    }>;
}
