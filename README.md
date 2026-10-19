REA for VS Code

Bring reverse engineering, inspection, and automation tools directly into Visual Studio Code.

REA for VS Code is an open-source Visual Studio Code extension developed by CAUCOLabs, designed to integrate the powerful capabilities of the REA reverse engineering framework into the developer’s everyday workflow.

The extension aims to provide a convenient interface for interacting with REA tools without leaving the editor.

Project Status: Sidebar MVP — MCP connection, dynamic tool discovery, schema inspection, and one allowlisted read-only query.

Overview

REA for VS Code connects Visual Studio Code with the REA engine using the Model Context Protocol (MCP).

The project focuses on making REA’s capabilities more accessible through an integrated development environment while maintaining compatibility with the original framework.

Planned Features

* Native VS Code Integration: Access REA functionality directly from the editor.
* MCP Connectivity: Communicate with the REA MCP server.
* Tool Discovery: Explore available REA tools.
* Tool Execution: Execute supported operations through an integrated interface.
* Browser Inspection: Access supported browser inspection capabilities.
* Automation Workflows: Run supported automation tasks.
* Results Viewer: Display structured results and execution logs.
* AI-Assisted Workflows: Future support for natural-language interaction with REA tools.
* Configurable Environment: Manage REA installation paths and connection settings.

The sidebar currently supports connection controls, tool discovery and search, schema inspection, and the read-only list_unknowns query. Other features listed above remain development goals.

Architecture

Visual Studio Code
        |
        v
REA for VS Code
        |
        v
MCP Client
        |
        v
REA MCP Server
        |
        v
REA Tools and Services

The extension is designed as an independent integration layer.

The original REA engine remains a separate project.

Technology Stack

* TypeScript
* Visual Studio Code Extension API
* Model Context Protocol (MCP)
* Node.js
* REA Engine

Development Roadmap

Phase 1 — Foundation

* Initialize the VS Code extension project.
* Implement basic extension activation.
* Establish communication with the REA MCP server.
* Implement connection status and error handling.

Phase 2 — Tool Integration

* Discover available MCP tools.
* Implement tool execution.
* Display structured results.
* Introduce configuration management.

Phase 3 — Developer Experience

* Build an integrated sidebar.
* Improve execution workflows.
* Add history and logging.
* Introduce permission controls.

Phase 4 — AI Integration

* Integrate optional AI providers.
* Enable natural-language tool interaction.
* Support multi-step workflows.
* Introduce supervised agent capabilities.

Requirements

Development and runtime requirements will be documented as implementation progresses.

The initial integration will target the REA MCP server.

Installation

The extension is not yet available for installation.

Development builds and installation instructions will be provided in future releases.

Sidebar MVP development guide

1. Install dependencies with `npm ci` and run `npm run build`.
2. Open this extension repository in VS Code. Review the source before trusting the workspace.
3. In User Settings, set `rea.executable` to the absolute path of your Node.js executable and `rea.scriptPath` to the absolute path of the separate REA installation's `scripts/rea.mjs`. Use `command -v node` on macOS/Linux or `where node` on Windows to locate Node. Absolute executable paths avoid VS Code's reduced PATH on macOS. These settings have machine scope; do not put local paths or credentials in this repository.
4. Press F5 and select **Run REA Extension**. This starts an Extension Development Host.
5. In the development host, open a trusted workspace and select the **REA** Activity Bar icon.
6. Click **Connect**. The sidebar retrieves the tool catalog from the running server. If connecting with the command palette instead, click **Refresh tools** afterward.
7. Search names or descriptions in the compact scrollable list. Tools are grouped by their literal name prefix (for example `list_*`), not by inferred capabilities. Select a name to highlight it and inspect the full description and parameter table. Expand **Raw JSON Schema** for composite or nested constraints. The table is documentation, not an argument editor.
8. Select **list_unknowns**, then click **Run read-only query (first 50)**. The extension sends fixed arguments `{ "offset": 0, "limit": 50 }`. An empty result is valid for a fresh session. The result explicitly shows **Success** or **Error**, prefers MCP `structuredContent`, and otherwise parses JSON text blocks or displays plain text. Expand **Original MCP response** to inspect the redacted response envelope (the existing output limit still applies). No other tool can execute through this MVP.
9. Click **Disconnect** to close the MCP connection. The catalog and result are cleared.

If `rea.scriptPath` is empty, the existing `npx --no-install rea-agents mcp` fallback is retained. Its availability is not validated across installations; an explicit Node executable and REA script path are recommended for development.

Security and validation limits

- Untrusted workspaces cannot start REA through the Connect command. Execution also checks trust and connection status in the extension host; Webview messages cannot supply tool names, arguments, paths, or commands.
- The view uses a nonce-based Content Security Policy, local resources only, and text-only rendering of server content. It does not persist results. Displayed results are limited to 100,000 characters and known credential fields/token formats are redacted before delivery. Redaction cannot identify every secret embedded in arbitrary prose; do not load sensitive investigation data into this prototype.
- Installed stable VS Code types expose `workspace.isTrusted` and `onDidGrantWorkspaceTrust`, but no trust-revocation event. Automatic disconnection on revocation is not implemented. Existing lifecycle limitations include inability to cancel a connection in progress and no verified termination of all descendant processes.
- The selected operation was inspected in the separate REA source: `SESSION_TOOL_CONTRACTS` declares `list_unknowns` read-only, and `registerSessionRecordTools.ts` calls `session.listUnknownsPage`. No target file or external provider is needed. The extension enables execution only when that exact name is present in the live catalog; it assumes the configured server is the intended REA installation.
- `npm test` covers command-level Workspace Trust guards, catalog delivery, message validation, the execution allowlist, redaction, and connection state notifications using SDK/VS Code mocks. Presentation tests execute the shipped Webview scripts with a small DOM double and cover prefix grouping, compact names, selection, schema parameters, structured/error results, raw response access, and hostile output. Browser layout and CSP enforcement require a real Extension Development Host.
- The baseline sidebar MVP was manually verified by the user inside VS Code: connection, 207 dynamically loaded tools, search, selection, descriptions, schemas, and successful `list_unknowns` execution with displayed results. The subsequent compact list and result presentation changes still require visual verification.
- A direct stdio invocation against the local REA engine returned a successful `list_unknowns` response with the fixed arguments. This verifies the selected engine operation, not the sidebar UI.

Original Project and Attribution

This extension is built to integrate with REA, an open-source reverse engineering framework created by morluto.

Original REA repository:

https://github.com/morluto/rea

REA is distributed under the MIT License.

Copyright (c) 2026 morluto.

REA for VS Code is an independent community-developed extension.

It is not an official REA release and is not affiliated with or endorsed by the original project maintainer.

All rights to the original REA source code remain with their respective copyright holders.

Extension Development

REA for VS Code

Developed and maintained by CAUCOLabs.

The extension’s integration architecture, Visual Studio Code interface, and extension-specific functionality are developed as an independent project.

Contributing

Contributions, bug reports, feature requests, and technical discussions are welcome.

Contribution guidelines will be published as the project develops.

Security

Reverse engineering and automation tools may interact with external processes, files, and applications.

The extension will prioritize explicit user authorization, controlled tool execution, and transparent reporting of operations.

License

REA for VS Code is licensed under the MIT License.

Copyright (c) 2026 CAUCOLabs.

The original REA project is separately licensed under the MIT License, Copyright (c) 2026 morluto.

See the respective license notices for details.