# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Node.js 20 job template repository** that provides boilerplate and examples for creating JavaScript/TypeScript jobs that run on the SGNL Job Service. This repository serves as a starting point for developers who want to create new JavaScript jobs that can be executed by the job service infrastructure.

## Repository Structure

```
sgnl-job-template/
├── examples/           # Example JavaScript job implementations
├── templates/         # Reusable Node.js job templates
├── schemas/           # JSON schemas for job specifications
├── docs/              # Documentation and guides
├── package.json       # Node.js dependencies and scripts
└── scripts/           # Utility scripts for job development
```

## Job Type

This template repository is specifically for the **nodejs-20** job type:

- **Runtime**: Node.js 20 with modern JavaScript/TypeScript support
- **Purpose**: JavaScript/TypeScript job execution in the SGNL Job Service
- **Container**: Optimized distroless Node.js 20 runtime environment

## Template Usage

### Creating a New JavaScript Job

1. **Choose a template** from the `templates/` directory
2. **Copy the template** to your working directory
3. **Customize the job specification** in the JSON file
4. **Implement your JavaScript logic** in the main script file
5. **Test locally** using the job service development environment

### Job Specification Format

JavaScript jobs are defined using this JSON specification format:

```json
{
  "id": "unique-job-id",
  "type": "nodejs-20",
  "tenant_id": "your-tenant",
  "timeout": "300s",
  "priority": 1000,
  "script": {
    "repository": "job-template-repo",
    "version": "main", 
    "type": "nodejs",
    "entry_point": "index.js"
  },
  "environment": {
    "NODE_ENV": "production"
  },
  "inputs": {
    "data": "value",
    "config": {}
  }
}
```

## Development Guidelines

### Best Practices for JavaScript Jobs

- **Keep jobs focused** - Each JavaScript job should have a single, clear responsibility
- **Handle errors gracefully** - Use try/catch blocks and provide meaningful error messages
- **Use structured logging** - Emit logs in JSON format for Loki aggregation
- **Set appropriate timeouts** - Consider JavaScript execution time when setting timeouts
- **Document inputs/outputs** - Clearly document expected inputs and outputs
- **Use modern JavaScript** - Leverage ES2023+ features available in Node.js 20
- **Handle async operations** - Use async/await patterns for cleaner asynchronous code

### Required Labels for Logging

For proper log aggregation, ensure your jobs emit structured logs with these labels:
- `service="job-service"`
- `job_id="<job-id>"`
- `tenant_id="<tenant-id>"`

### Environment Variables Available

JavaScript jobs have access to these environment variables:
- `JOB_ID` - Unique identifier for the job instance
- `JOB_TYPE` - Always "nodejs-20" for JavaScript jobs
- `TENANT_ID` - Tenant identifier
- `WORKER_ID` - ID of the worker executing the job

## Testing Your JavaScript Jobs

### Local Testing

1. Set up the job service development environment
2. Submit your JavaScript job using the dispatcher API
3. Monitor execution through the registry
4. Check logs via Loki (if enabled)
5. Use Node.js debugging tools for local development

### Integration Testing

- Create test cases that cover typical JavaScript inputs and edge cases
- Test error handling and timeout scenarios for JavaScript execution
- Verify log output format and content
- Test environment variable interpolation in JavaScript
- Test async/await patterns and Promise handling

## Related Repositories

- **job_service** - Main job execution infrastructure
- **sgnl-job-hello-world** - Simple "hello world" job example

## Important Notes

- This is a Node.js 20 template repository - breaking changes are expected as the job service evolves
- Always test JavaScript jobs in a development environment before production use
- Follow SGNL security guidelines for handling sensitive data in JavaScript
- JavaScript jobs should be idempotent when possible
- Use Node.js 20 features like top-level await and modern ES modules

## Getting Help

- Check the `examples/` directory for working JavaScript implementations
- Review the job service documentation for nodejs-20 job type details
- Use the job service integration tests as reference implementations
- Leverage Node.js 20 documentation for language features