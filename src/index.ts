// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import dotenv from "dotenv";
import { GoogleAuth } from 'google-auth-library'; // Needed for error type checking
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env file if it exists
try {
    dotenv.config({ path: process.env.ENV_FILE || '.env' });
} catch (error) {
    console.error("Note: No .env file found, using environment variables directly.");
}

// --- Configuration ---
const MCP_PROTOCOL_VERSION = "1.0"; // Can also come from the SDK

// --- Initialize Google Analytics Admin Client ---
let analyticsDataClient: BetaAnalyticsDataClient | null = null;

try {
    // The client automatically uses the credentials from the
    // GOOGLE_APPLICATION_CREDENTIALS environment variable.
    analyticsDataClient = new BetaAnalyticsDataClient();
    console.error("Google Analytics Clients initialized."); // Log to stderr
} catch (error) {
    console.error("Error initializing Google Clients:", error);
    // Stop the process if the client cannot be initialized
    process.exit(1);
}

// Read version from package.json
let packageVersion = "1.0.0"; // Default version
try {
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packageVersion = packageJson.version || packageVersion;
    }
} catch (error) {
    console.error("Kon package.json niet lezen, gebruik standaard versie:", error);
}

// --- Create MCP Server Instance ---
const server = new McpServer({
    name: "google-analytics-data",
    version: packageVersion,
    protocolVersion: MCP_PROTOCOL_VERSION, // Specify protocol version
    // descriptions and other metadata can be added here
});

// --- Helper function for error messages ---
function createErrorResponse(message: string, error?: any): CallToolResult {
    let detailedMessage = message;
    if (error) {
        // Try to recognize specific Google API errors
        if (error.code && error.details) { // Standard gRPC error structure
             detailedMessage = `${message}: Google API Error ${error.code} - ${error.details}`;
        } else if (error instanceof Error) {
            detailedMessage = `${message}: ${error.message}`;
        } else {
            detailedMessage = `${message}: ${String(error)}`;
        }
    }
     console.error("MCP Tool Error:", detailedMessage); // Log errors to stderr
    return {
        isError: true,
        content: [{ type: "text", text: detailedMessage }],
    };
}

// --- Helper function to obtain an access token for the Google API ---
async function getAccessToken(): Promise<string> {
    try {
        const auth = new GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        return token.token || "";
    } catch (error) {
        console.error("Error getting access token:", error);
        throw error;
    }
}

// --- Tool: Run Report ---
server.tool(
    "ga4_data_api_run_report",
    "Run a report using the Google Analytics 4 Data API.",
    {
        property_id: z.string().regex(/^\d+$/, "Property ID must be numeric").describe("The numeric ID of the GA4 property (e.g., '123456789')"),
        date_ranges: z.array(z.object({
            start_date: z.string().describe("Start date in YYYY-MM-DD format"),
            end_date: z.string().describe("End date in YYYY-MM-DD format")
        })).describe("Date ranges for the report"),
        dimensions: z.array(z.string()).describe("List of dimensions (e.g., ['date', 'country', 'deviceCategory'])"),
        metrics: z.array(z.string()).describe("List of metrics (e.g., ['activeUsers', 'sessions', 'screenPageViews'])"),
        limit: z.number().optional().describe("Optional limit for the number of rows returned"),
        offset: z.number().optional().describe("Optional offset for pagination"),
        dimension_filter: z.string().optional().describe("Optional JSON string with dimension filter"),
        metric_filter: z.string().optional().describe("Optional JSON string with metric filter"),
        order_bys: z.array(z.object({
            dimension: z.string().optional(),
            metric: z.string().optional(),
            desc: z.boolean().optional()
        })).optional().describe("Optional ordering of results")
    },
    async ({ property_id, date_ranges, dimensions, metrics, limit, offset, dimension_filter, metric_filter, order_bys }): Promise<CallToolResult> => {
        if (!analyticsDataClient) {
            return createErrorResponse("GA Data Client is not initialized.");
        }

        console.error(`Running tool: ga4_data_api_run_report for property ${property_id}`); // Log to stderr

        try {
            // Prepare the request
            const request: any = {
                property: `properties/${property_id}`,
                dateRanges: date_ranges.map(range => ({
                    startDate: range.start_date,
                    endDate: range.end_date
                })),
                dimensions: dimensions.map(dim => ({ name: dim })),
                metrics: metrics.map(metric => ({ name: metric }))
            };

            // Add optional parameters if provided
            if (limit !== undefined) {
                request.limit = limit;
            }

            if (offset !== undefined) {
                request.offset = offset;
            }

            // Parse and add dimension filter if provided
            if (dimension_filter) {
                try {
                    request.dimensionFilter = JSON.parse(dimension_filter);
                } catch (error) {
                    return createErrorResponse("Invalid dimension_filter JSON format", error);
                }
            }

            // Parse and add metric filter if provided
            if (metric_filter) {
                try {
                    request.metricFilter = JSON.parse(metric_filter);
                } catch (error) {
                    return createErrorResponse("Invalid metric_filter JSON format", error);
                }
            }

            // Add order bys if provided
            if (order_bys && order_bys.length > 0) {
                request.orderBys = order_bys.map(orderBy => {
                    const result: any = {};
                    if (orderBy.dimension) result.dimension = { dimensionName: orderBy.dimension };
                    if (orderBy.metric) result.metric = { metricName: orderBy.metric };
                    if (orderBy.desc !== undefined) result.desc = orderBy.desc;
                    return result;
                });
            }

            console.error('API Request (ga4_data_api_run_report):', JSON.stringify(request, null, 2));

            // Run the report
            const [response] = await analyticsDataClient.runReport(request);

            // Format the response
            const formattedResponse = {
                dimensionHeaders: response.dimensionHeaders?.map(header => header.name) || [],
                metricHeaders: response.metricHeaders?.map(header => header.name) || [],
                rows: response.rows?.map(row => {
                    return {
                        dimensionValues: row.dimensionValues?.map(value => value.value) || [],
                        metricValues: row.metricValues?.map(value => value.value) || []
                    };
                }) || [],
                rowCount: response.rowCount,
                metadata: response.metadata,
                kind: response.kind
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(formattedResponse, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            // Handle API-specific errors
            if (error.code === 5) { // gRPC code 5 = NOT_FOUND
                return createErrorResponse(`Property '${property_id}' not found.`, error);
            }
            if (error.code === 7) { // gRPC code 7 = PERMISSION_DENIED
                return createErrorResponse(`Permission denied to access property '${property_id}'. Check Service Account permissions in GA4.`, error);
            }
            
            return createErrorResponse(`Error running report for property '${property_id}'`, error);
        }
    }
);

// --- Tool: Run Realtime Report ---
server.tool(
    "ga4_data_api_run_realtime_report",
    "Run a realtime report using the Google Analytics 4 Data API.",
    {
        property_id: z.string().regex(/^\d+$/, "Property ID must be numeric").describe("The numeric ID of the GA4 property (e.g., '123456789')"),
        dimensions: z.array(z.string()).describe("List of dimensions (e.g., ['country', 'deviceCategory'])"),
        metrics: z.array(z.string()).describe("List of metrics (e.g., ['activeUsers', 'screenPageViews'])"),
        limit: z.number().optional().describe("Optional limit for the number of rows returned"),
        dimension_filter: z.string().optional().describe("Optional JSON string with dimension filter"),
        metric_filter: z.string().optional().describe("Optional JSON string with metric filter")
    },
    async ({ property_id, dimensions, metrics, limit, dimension_filter, metric_filter }): Promise<CallToolResult> => {
        if (!analyticsDataClient) {
            return createErrorResponse("GA Data Client is not initialized.");
        }

        console.error(`Running tool: ga4_data_api_run_realtime_report for property ${property_id}`); // Log to stderr

        try {
            // Prepare the request
            const request: any = {
                property: `properties/${property_id}`,
                dimensions: dimensions.map(dim => ({ name: dim })),
                metrics: metrics.map(metric => ({ name: metric }))
            };

            // Add optional parameters if provided
            if (limit !== undefined) {
                request.limit = limit;
            }

            // Parse and add dimension filter if provided
            if (dimension_filter) {
                try {
                    request.dimensionFilter = JSON.parse(dimension_filter);
                } catch (error) {
                    return createErrorResponse("Invalid dimension_filter JSON format", error);
                }
            }

            // Parse and add metric filter if provided
            if (metric_filter) {
                try {
                    request.metricFilter = JSON.parse(metric_filter);
                } catch (error) {
                    return createErrorResponse("Invalid metric_filter JSON format", error);
                }
            }

            console.error('API Request (ga4_data_api_run_realtime_report):', JSON.stringify(request, null, 2));

            // Run the realtime report
            const [response] = await analyticsDataClient.runRealtimeReport(request);

            // Format the response
            const formattedResponse = {
                dimensionHeaders: response.dimensionHeaders?.map(header => header.name) || [],
                metricHeaders: response.metricHeaders?.map(header => header.name) || [],
                rows: response.rows?.map(row => {
                    return {
                        dimensionValues: row.dimensionValues?.map(value => value.value) || [],
                        metricValues: row.metricValues?.map(value => value.value) || []
                    };
                }) || [],
                rowCount: response.rowCount,
                kind: response.kind
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(formattedResponse, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            // Handle API-specific errors
            if (error.code === 5) { // gRPC code 5 = NOT_FOUND
                return createErrorResponse(`Property '${property_id}' not found.`, error);
            }
            if (error.code === 7) { // gRPC code 7 = PERMISSION_DENIED
                return createErrorResponse(`Permission denied to access property '${property_id}'. Check Service Account permissions in GA4.`, error);
            }
            
            return createErrorResponse(`Error running realtime report for property '${property_id}'`, error);
        }
    }
);

// --- Tool: Get Metadata ---
server.tool(
    "ga4_data_api_get_metadata",
    "Get metadata about available dimensions and metrics in GA4.",
    {
        property_id: z.string().regex(/^\d+$/, "Property ID must be numeric").describe("The numeric ID of the GA4 property (e.g., '123456789')")
    },
    async ({ property_id }): Promise<CallToolResult> => {
        if (!analyticsDataClient) {
            return createErrorResponse("GA Data Client is not initialized.");
        }

        console.error(`Running tool: ga4_data_api_get_metadata for property ${property_id}`); // Log to stderr

        try {
            // Get the metadata
            const [metadata] = await analyticsDataClient.getMetadata({
                name: `properties/${property_id}/metadata`
            });

            // Format the response
            const formattedResponse = {
                dimensions: metadata.dimensions?.map(dim => ({
                    apiName: dim.apiName,
                    uiName: dim.uiName,
                    description: dim.description,
                    category: dim.category,
                    customDefinition: dim.customDefinition
                })) || [],
                metrics: metadata.metrics?.map(metric => ({
                    apiName: metric.apiName,
                    uiName: metric.uiName,
                    description: metric.description,
                    category: metric.category,
                    expression: metric.expression,
                    type: metric.type
                })) || []
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(formattedResponse, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            // Handle API-specific errors
            if (error.code === 5) { // gRPC code 5 = NOT_FOUND
                return createErrorResponse(`Property '${property_id}' not found.`, error);
            }
            if (error.code === 7) { // gRPC code 7 = PERMISSION_DENIED
                return createErrorResponse(`Permission denied to access property '${property_id}'. Check Service Account permissions in GA4.`, error);
            }
            
            return createErrorResponse(`Error getting metadata for property '${property_id}'`, error);
        }
    }
);

// --- Start the server with Stdio Transport ---
async function main() {
    try {
        // Use StdioServerTransport like in the example
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Google Analytics Data MCP Server running on stdio"); // Log to stderr
    } catch (error) {
        console.error("Fatal error connecting MCP server:", error);
        process.exit(1);
    }
}

// Run main function
main().catch((error) => {
    console.error("Unhandled error in main():", error);
    process.exit(1);
});