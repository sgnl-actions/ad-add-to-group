# Active Directory Add User to Group Action

This action adds a user to a group in on-premise Active Directory using LDAP/LDAPS.

## Overview

The AD Add User to Group action enables automated group membership management by adding users to Active Directory security groups or distribution groups via LDAP. It handles LDAP bind authentication, TLS configuration, and provides idempotent handling when a user is already a member of the target group.

## Prerequisites

- On-premise Active Directory domain controller accessible via LDAP or LDAPS
- A service account with permissions to modify group membership
  - Typically requires **Write** permission on the `member` attribute of target groups
- Network connectivity from the execution environment to the LDAP server

## Configuration

### Authentication

This action uses LDAP Simple Bind authentication with a service account.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `LDAP_BIND_DN` | Secret | Yes | Bind DN of the service account (e.g., `CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com`) |
| `LDAP_BIND_PASSWORD` | Secret | Yes | Password for the service account |

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ADDRESS` | Yes | LDAP server URL | `ldaps://ad.corp.example.com:636` |
| `TLS_SKIP_VERIFY` | No | Set to `true` to skip TLS certificate verification | `true` |

### Input Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `userDN` | string | Yes | Distinguished Name of the user to add | `CN=John Doe,OU=Users,DC=corp,DC=example,DC=com` |
| `groupDN` | string | Yes | Distinguished Name of the target group | `CN=Admins,OU=Groups,DC=corp,DC=example,DC=com` |
| `address` | string | No | Optional LDAP server URL override | `ldaps://ad.corp.example.com:636` |

### Output Structure

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Operation result (success, failed, etc.) |
| `userDN` | string | Distinguished Name of the user that was processed |
| `groupDN` | string | Distinguished Name of the group that was processed |
| `added` | boolean | Whether the user was newly added to the group |
| `address` | string | The LDAP server URL that was used |
| `message` | string | Optional message providing additional context (e.g., when user is already a member) |

## Usage Examples

### Basic Usage

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=corp,DC=example,DC=com",
  "groupDN": "CN=HR Group,OU=Groups,DC=corp,DC=example,DC=com"
}
```

### Job Specification

```json
{
  "id": "add-user-to-hr-group",
  "type": "nodejs-22",
  "script": {
    "repository": "github.com/sgnl-actions/ad-add-to-group",
    "version": "v1.0.0",
    "type": "nodejs"
  },
  "script_inputs": {
    "userDN": "CN=New Employee,OU=Users,DC=corp,DC=example,DC=com",
    "groupDN": "CN=HR Group,OU=Groups,DC=corp,DC=example,DC=com"
  },
  "environment": {
    "ADDRESS": "ldaps://ad.corp.example.com:636"
  },
  "secrets": {
    "LDAP_BIND_DN": "CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com",
    "LDAP_BIND_PASSWORD": "your-service-account-password"
  }
}
```

### With TLS Skip Verify

For environments with self-signed certificates:

```json
{
  "id": "add-user-to-hr-group",
  "type": "nodejs-22",
  "script": {
    "repository": "github.com/sgnl-actions/ad-add-to-group",
    "version": "v1.0.0",
    "type": "nodejs"
  },
  "script_inputs": {
    "userDN": "CN=New Employee,OU=Users,DC=corp,DC=example,DC=com",
    "groupDN": "CN=HR Group,OU=Groups,DC=corp,DC=example,DC=com"
  },
  "environment": {
    "ADDRESS": "ldaps://ad.corp.example.com:636",
    "TLS_SKIP_VERIFY": "true"
  },
  "secrets": {
    "LDAP_BIND_DN": "CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com",
    "LDAP_BIND_PASSWORD": "your-service-account-password"
  }
}
```

## API Details

This action uses the LDAP modify operation to add a user DN to the `member` attribute of the target group:

```
MODIFY groupDN
  ADD member: userDN
```

The connection lifecycle is stateless: each invocation binds to the LDAP server, performs the modify operation, and unbinds in a `finally` block.

## Error Handling

### Success Scenarios

- **Modify succeeds**: User successfully added to group (`added: true`)
- **LDAP error code 68** (`ENTRY_ALREADY_EXISTS`): User is already a member, treated as success (`added: false`)

### Retryable Errors

The framework automatically retries on transient errors such as:
- Network connectivity issues
- LDAP server temporarily unavailable
- Connection timeouts

### Fatal Errors

| LDAP Code | Error | Description |
|-----------|-------|-------------|
| 49 | Invalid Credentials | Bind DN or password is incorrect |
| 50 | Insufficient Access Rights | Service account lacks permission to modify the group |
| 32 | No Such Object | The user DN or group DN does not exist |
| 34 | Invalid DN Syntax | Malformed Distinguished Name |

## Security Considerations

- **Authentication**: Uses LDAP Simple Bind with a dedicated service account
- **Transport Security**: Supports LDAPS (LDAP over TLS) for encrypted connections
- **TLS Verification**: Certificate verification is enabled by default; `TLS_SKIP_VERIFY` should only be used in development or with self-signed certificates
- **Credential Security**: Bind credentials are provided via secrets and are never logged
- **Connection Lifecycle**: Connections are unbound in a `finally` block to prevent resource leaks

## Development

### Setup

```bash
npm install
```

### Run tests

```bash
npm test
```

### Run tests in watch mode

```bash
npm run test:watch
```

### Build

```bash
npm run build
```

### Validate metadata

```bash
npm run validate
```

### Lint

```bash
npm run lint
npm run lint:fix
```

### Local testing

Create a `../.env` file with your AD credentials:

```
AD_ADDRESS=ldap://your-dc.example.com:389
LDAP_BIND_DN=CN=admin,DC=example,DC=com
LDAP_BIND_PASSWORD=your-password
TLS_SKIP_VERIFY=false
```

Then run:

```bash
npm run dev
```

## Troubleshooting

### Common Issues

1. **"Missing LDAP bind credentials"**
   - Ensure `LDAP_BIND_DN` and `LDAP_BIND_PASSWORD` are set in secrets
   - Verify the bind DN is a valid Distinguished Name

2. **"No URL specified"**
   - Ensure the `ADDRESS` environment variable is set or `address` is provided in params
   - Verify the URL format (e.g., `ldaps://ad.corp.example.com:636`)

3. **"Invalid credentials"**
   - Verify the service account DN and password are correct
   - Check that the account is not locked or expired in Active Directory

4. **"Insufficient access rights"**
   - Verify the service account has Write permission on the `member` attribute of the target group
   - Check if there are any deny ACEs blocking the operation

5. **"No such object" (LDAP code 32)**
   - Verify the user DN exists in Active Directory
   - Verify the group DN exists in Active Directory
   - Check for typos in the Distinguished Names

6. **TLS/SSL connection errors**
   - Verify the LDAP server is accessible on the configured port
   - For LDAPS, ensure the server certificate is trusted or set `TLS_SKIP_VERIFY=true` for testing
   - Check that the correct port is used (389 for LDAP, 636 for LDAPS)

### Testing Group Membership

To verify the action worked correctly, you can check group membership using:

```bash
# Using ldapsearch
ldapsearch -H ldaps://ad.corp.example.com:636 \
  -D "CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com" \
  -W -b "CN=Target Group,OU=Groups,DC=corp,DC=example,DC=com" \
  "(objectClass=group)" member

# Using PowerShell
Get-ADGroupMember -Identity "Target Group" | Where-Object { $_.Name -eq "John Doe" }
```

## Support

- [ldapts Documentation](https://github.com/ldapts/ldapts)
- [Active Directory LDAP Reference](https://docs.microsoft.com/en-us/windows/win32/ad/active-directory-domain-services)
- [SGNL Actions Documentation](https://github.com/sgnl-actions)
