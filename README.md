# Active Directory Add Member to Group Action

This action adds a member (user **or** group) to a group in on-premise Active Directory using LDAP/LDAPS, with optional support for AD's temporary group membership (TTL) feature.

## Overview

The action looks up a member by `sAMAccountName` — which is unique per domain and resolves to either a user or a group — then adds that member to the specified group's `member` attribute. When `ttlSeconds` is supplied, the membership is added with AD's temporary-membership syntax (`<TTL=N>,DN`), and AD automatically removes the membership when the TTL elapses. The action handles LDAP bind authentication, TLS configuration, and provides idempotent handling when a member is already in the target group (no-TTL case).

## Prerequisites

- On-premise Active Directory domain controller accessible via LDAP or LDAPS
- A service account with permissions to:
  - Search for users and groups in the specified base DN
  - Modify the `member` attribute on target groups
- Network connectivity from the execution environment to the LDAP server
- **For TTL (temporary) memberships only:**
  - Forest Functional Level Windows Server 2016 or higher
  - The Privileged Access Management Feature enabled in the forest:
    ```powershell
    Enable-ADOptionalFeature -Identity 'Privileged Access Management Feature' \
      -Scope ForestOrConfigurationSet -Target <your-domain>
    ```
  - Note: this feature **cannot be disabled** once enabled.

## Configuration

### Authentication

This action uses LDAP Simple Bind authentication with a service account.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `BASIC_USERNAME` | Secret | Yes | Bind DN of the service account (e.g., `CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com`) |
| `BASIC_PASSWORD` | Secret | Yes | Password for the service account |

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ADDRESS` | Yes | LDAP server URL | `ldaps://ad.corp.example.com:636` |
| `TLS_SKIP_VERIFY` | No | Set to `true` to skip TLS certificate verification | `true` |

### Input Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `baseDN` | string | Yes | Base DN to search for the member | `DC=corp,DC=example,DC=com` |
| `samAccountName` | string | Yes | sAMAccountName of the user or group to add (unique per domain) | `jdoe` or `Engineering` |
| `groupDN` | string | Yes | Distinguished Name of the target group | `CN=Admins,OU=Groups,DC=corp,DC=example,DC=com` |
| `ttlSeconds` | integer | No | Time-to-live in seconds for temporary group membership. See [Temporary Group Membership (TTL)](#temporary-group-membership-ttl). | `3600` |
| `address` | string | No | Optional LDAP server URL override | `ldaps://ad.corp.example.com:636` |
| `dry_run` | boolean | No | When true, validates parameters without making changes | `false` |

### Output Structure

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Operation result (success, dry_run_completed, halted) |
| `memberDN` | string | Resolved Distinguished Name of the added member |
| `userDN` | string | Backward-compatible alias for `memberDN` (same value) |
| `groupDN` | string | Distinguished Name of the group that was processed |
| `added` | boolean | Whether the member was newly added to the group |
| `ttlSeconds` | integer | Echoed back when a TTL was requested |
| `address` | string | LDAP server URL that was used |
| `message` | string | Optional message providing additional context |

## Usage Examples

### Add a user to a group

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "groupDN": "CN=HR Group,OU=Groups,DC=corp,DC=example,DC=com"
}
```

### Add a group to a group (nested membership)

`sAMAccountName` is unique per domain, so the same input parameter resolves a group just as it does a user — no separate flag needed.

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "Engineering",
  "groupDN": "CN=All Staff,OU=Groups,DC=corp,DC=example,DC=com"
}
```

### Add a user with a 1-hour TTL

Membership expires automatically after 3600 seconds. Requires the PAM feature (see Prerequisites).

```json
{
  "baseDN": "DC=corp,DC=example,DC=com",
  "samAccountName": "jdoe",
  "groupDN": "CN=Domain Admins,OU=Groups,DC=corp,DC=example,DC=com",
  "ttlSeconds": 3600
}
```

### Job Specification

```json
{
  "id": "add-member-to-hr-group",
  "type": "nodejs-22",
  "script": {
    "repository": "github.com/sgnl-actions/ad-add-to-group",
    "version": "v1.0.0",
    "type": "nodejs"
  },
  "script_inputs": {
    "baseDN": "DC=corp,DC=example,DC=com",
    "samAccountName": "jdoe",
    "groupDN": "CN=HR Group,OU=Groups,DC=corp,DC=example,DC=com"
  },
  "environment": {
    "ADDRESS": "ldaps://ad.corp.example.com:636"
  },
  "secrets": {
    "BASIC_USERNAME": "CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com",
    "BASIC_PASSWORD": "your-service-account-password"
  }
}
```

### With TLS Skip Verify

For environments with self-signed certificates:

```json
{
  "id": "add-member-to-hr-group",
  "type": "nodejs-22",
  "script": {
    "repository": "github.com/sgnl-actions/ad-add-to-group",
    "version": "v1.0.0",
    "type": "nodejs"
  },
  "script_inputs": {
    "baseDN": "DC=corp,DC=example,DC=com",
    "samAccountName": "jdoe",
    "groupDN": "CN=HR Group,OU=Groups,DC=corp,DC=example,DC=com"
  },
  "environment": {
    "ADDRESS": "ldaps://ad.corp.example.com:636",
    "TLS_SKIP_VERIFY": "true"
  },
  "secrets": {
    "BASIC_USERNAME": "CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com",
    "BASIC_PASSWORD": "your-service-account-password"
  }
}
```

## API Details

This action performs the following LDAP operations:

1. **SEARCH** the base DN to find the member by `sAMAccountName` and get the Distinguished Name
2. **MODIFY** the group's `member` attribute to add the member DN (with TTL prefix when `ttlSeconds` is set)

```
SEARCH baseDN (scope=sub, filter=(&(|(objectClass=user)(objectClass=group))(sAMAccountName=<samAccountName>)))
MODIFY groupDN
  ADD member: <memberDN>                       # without TTL
  ADD member: <TTL=<ttlSeconds>>,<memberDN>    # with TTL
```

The connection lifecycle is stateless: each invocation binds to the LDAP server, performs the search/modify operations, and unbinds in a `finally` block.

## Temporary Group Membership (TTL)

When `ttlSeconds` is provided, the action submits the new member with AD's temporary-membership value syntax: `<TTL=N>,DN`. Active Directory will automatically remove the membership when the TTL elapses, and Kerberos TGT lifetimes for the user are reduced to match the shortest TTL across their group memberships.

**Prerequisites** (see top of doc): Forest Functional Level 2016+, PAM feature enabled.

**Important caveats:**

- **PAM feature not enabled** — AD silently ignores the `<TTL=…>` prefix; membership is created permanently rather than temporarily. The action cannot detect this server-side condition.
- **Member already in group** — AD will not overlay a TTL onto an existing non-temporary membership. The action throws an explicit error in this case (rather than the idempotent success returned when no TTL is requested). Remove the member first, then retry with `ttlSeconds`.
- **Clock skew** — TTL expiration relies on DC clock accuracy. Ensure NTP is healthy.
- **Azure AD Sync** — TTL-driven removals do not automatically propagate to Azure AD Connect.

Reference: [Privileged Access Management for Active Directory Domain Services — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-identity-manager/pam/privileged-identity-management-for-active-directory-domain-services).

## Error Handling

### Success Scenarios

- **Member added**: `added: true`
- **Already a member (no TTL)**: `added: false` (LDAP code 68 handled idempotently)

### Retryable Errors

| Error | Description |
|-------|-------------|
| Network timeout | Domain Controller unreachable |
| Connection refused | LDAP service not running |
| Server busy | DC under heavy load |

### Fatal Errors

| Error | Description |
|-------|-------------|
| Member not found with sAMAccountName | No user or group exists with the specified sAMAccountName |
| Multiple members found | More than one entry matches (should not happen — sAMAccountName is domain-unique) |
| TTL cannot be applied to an existing membership | `ttlSeconds` was set and the member is already in the group |
| ttlSeconds must be a positive integer | Invalid `ttlSeconds` input (e.g. zero, negative, non-integer) |
| Invalid Credentials | Bind DN or password is incorrect |
| Insufficient Access Rights | Service account lacks permission to modify the group |
| No Such Object | The group DN does not exist |
| Invalid DN Syntax | Malformed Distinguished Name |

## Security Considerations

- **Authentication**: Uses LDAP Simple Bind with a dedicated service account
- **Transport Security**: Supports LDAPS (LDAP over TLS) for encrypted connections
- **TLS Verification**: Certificate verification is enabled by default; `TLS_SKIP_VERIFY` should only be used in development or with self-signed certificates
- **Credential Security**: Bind credentials are provided via secrets and are never logged
- **Connection Lifecycle**: Connections are unbound in a `finally` block to prevent resource leaks
- **LDAP Filter Escaping**: Special characters in sAMAccountName are escaped to prevent LDAP injection

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

Copy the sample environment file and customize it:

```bash
cp .env.sample .env
```

Edit `.env` with your AD credentials:

```
ADDRESS=ldap://your-dc.example.com:389
BASIC_USERNAME=CN=admin,DC=example,DC=com
BASIC_PASSWORD=your-password
TLS_SKIP_VERIFY=false

# Test parameters - customize as needed
BASE_DN=DC=corp,DC=example,DC=com
SAM_ACCOUNT_NAME=jsmith
GROUP_DN=CN=Engineering Team,OU=Groups,DC=corp,DC=example,DC=com
TTL_SECONDS=
DRY_RUN=false
```

Then run:

```bash
npm run dev
```

## Troubleshooting

### Common Issues

1. **"Member not found with sAMAccountName"**
   - Verify the sAMAccountName is correct (case-insensitive in AD)
   - Check that the user or group exists within the specified baseDN

2. **"Multiple members found"**
   - This should not happen in a properly configured AD since sAMAccountName must be unique within a domain

3. **"Missing LDAP bind credentials"**
   - Ensure `BASIC_USERNAME` and `BASIC_PASSWORD` are set in secrets
   - Verify the bind DN is a valid Distinguished Name

4. **"No URL specified"**
   - Ensure the `ADDRESS` environment variable is set or `address` is provided in params
   - Verify the URL format (e.g., `ldaps://ad.corp.example.com:636`)

5. **"Invalid credentials"**
   - Verify the service account DN and password are correct
   - Check that the account is not locked or expired in Active Directory

6. **"Insufficient access rights"**
   - Verify the service account has Write permission on the `member` attribute of the target group
   - Check if there are any deny ACEs blocking the operation

7. **"No such object" (LDAP code 32)**
   - Verify the group DN exists in Active Directory
   - Check for typos in the Distinguished Name

8. **"TTL cannot be applied to an existing membership"**
   - The member is already in the group. AD will not overlay a TTL onto an existing non-temporary membership.
   - Remove the existing membership first, then retry with `ttlSeconds`.

9. **TTL was set but the membership is not expiring**
   - Verify the PAM feature is enabled (`Get-ADOptionalFeature 'Privileged Access Management Feature'`)
   - Confirm Forest Functional Level is 2016 or higher
   - Check DC time synchronization (clock skew can delay expiration)

10. **TLS/SSL connection errors**
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
Get-ADGroupMember -Identity "Target Group" | Where-Object { $_.SamAccountName -eq "jdoe" }
```

## Support

- [ldapts Documentation](https://github.com/ldapts/ldapts)
- [Active Directory LDAP Reference](https://docs.microsoft.com/en-us/windows/win32/ad/active-directory-domain-services)
- [Privileged Access Management for AD DS](https://learn.microsoft.com/en-us/microsoft-identity-manager/pam/privileged-identity-management-for-active-directory-domain-services)
- [SGNL Actions Documentation](https://github.com/sgnl-actions)
