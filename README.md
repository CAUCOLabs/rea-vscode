REA for VS Code

Bring reverse engineering, inspection, and automation tools directly into Visual Studio Code.

REA for VS Code is an open-source Visual Studio Code extension developed by CAUCOLabs, designed to integrate the powerful capabilities of the REA reverse engineering framework into the developer’s everyday workflow.

The extension aims to provide a convenient interface for interacting with REA tools without leaving the editor.

Project Status: Early Development — Architecture and Initial Integration.

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

Features listed above are development goals and are not yet implemented.

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