# Privacy policy

Applies to the Claude Code plugins in this repository: `nuvraxis-frontend` and `nuvraxis-fullstack`, published by Nuvraxis.
Last updated: 2026-10-19.

## Short version

The plugins don't collect, store, sell or share personal data. They contain no telemetry, analytics or tracking. Nuvraxis receives nothing from you when you install or use them, with the one exception described under "The nuvui MCP server".

## What the plugins are

Instructions (skills), file templates and small Node scripts that Claude Code reads and runs on your machine. Everything they do happens locally, in your project, through Claude Code:

- **Skills and templates** are text files. Reading them sends nothing anywhere.
- **The formatting hook** (`nuvraxis-frontend`) runs Biome, installed in your own project, on files Claude edits. It doesn't read credentials and makes no network requests.
- **The scaffold scripts** copy template files into a folder you choose. They make no network requests.

What Claude Code itself sends to Anthropic is covered by Anthropic's policies, not this one.

## The nuvui MCP server

`nuvraxis-frontend` registers one remote MCP server, `https://nuvui.nuvraxis.com/mcp`, which serves documentation for the nuvui component library. When Claude uses it, the request contains what Claude asked for: a component name, a search term or a guide name. It needs no account, no API key and no personal data. Requests to the server are handled under the nuvraxis.com privacy policy: https://nuvraxis.com/privacy.

You can turn the server off with `/mcp` in Claude Code, or uninstall the plugin.

## Things that happen because you run them

The plugins tell Claude how to build and ship apps. Commands that follow from that, such as installing packages from the npm registry, building Docker images, or pushing to GitHub and GitHub Container Registry, contact those third-party services under their own terms, using your own accounts. The plugins never send those credentials to Nuvraxis.

## Changes

Changes to this policy are made in this file and are visible in the repository's git history.

## Contact

hello@nuvraxis.com
