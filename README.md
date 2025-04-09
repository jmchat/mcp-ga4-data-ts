# Google Analytics 4 Data API MCP

A Model Context Protocol (MCP) server for accessing Google Analytics 4 reporting data.

## Installation

```bash
npm install -g mcp-ga4-data
```

Or use it directly via npx:

```bash
npx mcp-ga4-data
```

## Requirements

1. A Google Cloud project with the Google Analytics Data API enabled
2. A service account with appropriate permissions for Google Analytics
3. A credentials.json file for the service account

## Usage with Claude (or other MCP Clients)

This MCP is designed to work with Claude or other MCP Clients. To use it with Claude, create a `claude-mcp-config.json` file with the following content:

```json
{
  "mcpServers": {
    "google-analytics-data": {
      "command": "npx",
      "args": ["mcp-ga4-data"],
      "cwd": "/tmp",
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/your/credentials.json"
      }
    }
  }
}
```

Replace `/path/to/your/credentials.json` with the actual path to your Google service account credentials file.

## Configuration

You need to provide the path to your Google service account credentials file. There are two ways to do this:

### Option 1: Environment Variable

Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable directly:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=path/to/your/credentials.json
```

### Option 2: .env File (Optional)

Alternatively, you can create a `.env` file in the directory where you want to use the MCP with the following content:

```
GOOGLE_APPLICATION_CREDENTIALS=path/to/your/credentials.json
```

Note: The `.env` file is completely optional. The package will work fine with just the environment variable set.

## Available Functions

The MCP provides the following functions:

### Reporting Functions
- `ga4_data_api_run_report` - Run a standard GA4 report with dimensions and metrics
- `ga4_data_api_run_realtime_report` - Run a realtime GA4 report with dimensions and metrics
- `ga4_data_api_get_metadata` - Get metadata about available dimensions and metrics

## License

ISC
