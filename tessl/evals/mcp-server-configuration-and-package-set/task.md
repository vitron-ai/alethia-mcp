# Set Up Browser Test Automation for the Orion Project

## Problem/Feature Description

The Orion team has just started using Alethia for browser-based E2E testing. A new developer needs to configure the environment from scratch and get a sample test running against a local HTML fixture. The developer is using Claude Code as their AI agent and needs to configure the MCP integration correctly so the agent can call Alethia tools.

The developer has no existing Alethia setup. Produce a complete setup guide and the required configuration files so the developer can follow the steps and have a working Alethia test environment.

## Output Specification

Produce the following files:

- `setup_guide.md` — Step-by-step instructions for installing Alethia and configuring the MCP bridge, including the exact install command and what to add to the agent's MCP configuration.
- `mcp_config.json` — The complete MCP configuration snippet to add to the agent config, ready to copy and paste.
- `sample_test.txt` — A sample Alethia test instruction set (one step per line) that:
  1. Navigates to `file:///workspace/orion/index.html`
  2. Asserts that "Welcome to Orion" is visible
  3. Clicks the "Learn More" button
  4. Asserts that "Documentation" is visible
