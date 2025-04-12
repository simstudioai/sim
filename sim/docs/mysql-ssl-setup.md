# MySQL SSL Certificate Setup Guide

This guide provides step-by-step instructions for setting up SSL certificates for MySQL connections, particularly for AWS RDS MySQL instances.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Certificate Types](#certificate-types)
- [Setup Steps](#setup-steps)
- [Configuration](#configuration)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- MySQL server (local or AWS RDS)
- OpenSSL installed on your system
- Appropriate permissions to create and manage certificates
- Access to your MySQL server configuration

## Certificate Types

There are three main types of SSL certificates used in MySQL:

1. **CA Certificate (Certificate Authority)**
   - Used to verify the server's identity
   - Required for all SSL connections
   - For AWS RDS, use the provided RDS CA certificate

2. **Server Certificate**
   - Used by the MySQL server to prove its identity
   - Required for server-side SSL
   - For AWS RDS, this is managed by AWS

3. **Client Certificate**
   - Used for client authentication (mutual TLS)
   - Optional, only required if using mutual TLS authentication

## Setup Steps

### 1. Download AWS RDS CA Certificate

For AWS RDS MySQL instances:

```bash
# Create directory for certificates
mkdir -p ~/.mysql/certs

# Download the RDS CA certificate
curl -o ~/.mysql/certs/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

### 2. Generate Client Certificates (Optional, for Mutual TLS)

If you need mutual TLS authentication:

```bash
# Generate private key
openssl genrsa -out client-key.pem 2048

# Generate certificate signing request
openssl req -new -key client-key.pem -out client-cert.csr

# Generate self-signed certificate
openssl x509 -req -days 365 -in client-cert.csr -signkey client-key.pem -out client-cert.pem
```

### 3. Configure MySQL Server (for local MySQL)

If you're using a local MySQL server, add these lines to your `my.cnf`:

```ini
[mysqld]
ssl-ca=/path/to/ca-cert.pem
ssl-cert=/path/to/server-cert.pem
ssl-key=/path/to/server-key.pem
require_secure_transport=ON  # Optional: force SSL connections
```

## Configuration

### Client Configuration

In your application code, configure the SSL settings:

```typescript
const sslConfig = {
  rejectUnauthorized: true,  // Enable certificate validation
  ca: fs.readFileSync('/path/to/global-bundle.pem'),  // CA certificate
  // For mutual TLS, include these:
  cert: fs.readFileSync('/path/to/client-cert.pem'),  // Client certificate
  key: fs.readFileSync('/path/to/client-key.pem')     // Client private key
};

const connection = {
  host: 'your-rds-endpoint',
  port: 3306,
  user: 'your-username',
  password: 'your-password',
  database: 'your-database',
  ssl: sslConfig
};
```

### Environment Variables

Set these environment variables in your `.env` file:

```bash
MYSQL_SSL=true
MYSQL_SSL_CA=/path/to/global-bundle.pem
MYSQL_SSL_CERT=/path/to/client-cert.pem  # If using mutual TLS
MYSQL_SSL_KEY=/path/to/client-key.pem     # If using mutual TLS
```

## Testing

### 1. Test SSL Connection

```sql
-- Connect to MySQL and run:
SHOW VARIABLES LIKE '%ssl%';
```

Expected output should show SSL is enabled.

### 2. Verify Certificate

```sql
-- Check the SSL certificate being used:
SHOW STATUS LIKE 'Ssl_cipher';
```

### 3. Test Connection from Application

```typescript
try {
  const connection = await mysql.createConnection(config);
  await connection.query('SELECT 1');
  console.log('SSL connection successful!');
} catch (error) {
  console.error('SSL connection failed:', error);
}
```

## Troubleshooting

### Common Issues

1. **Certificate Not Found**
   - Verify certificate paths are correct
   - Check file permissions
   - Ensure certificates are readable by the application

2. **Certificate Validation Failed**
   - Verify CA certificate matches the server's certificate chain
   - Check certificate expiration dates
   - Ensure system time is correct

3. **Connection Refused**
   - Verify MySQL server is configured to accept SSL connections
   - Check firewall rules allow SSL port (usually 3306)
   - Confirm server's SSL configuration is correct

### Debug Commands

```bash
# Verify certificate content
openssl x509 -in global-bundle.pem -text -noout

# Test SSL connection
mysql --ssl-ca=/path/to/global-bundle.pem -h your-host -u your-user -p

# Check SSL configuration
mysql -e "SHOW VARIABLES LIKE '%ssl%';"
```

## Security Best Practices

1. **Certificate Management**
   - Store certificates securely
   - Use appropriate file permissions (600 for private keys)
   - Regularly rotate certificates
   - Monitor certificate expiration

2. **Connection Security**
   - Always use `rejectUnauthorized: true`
   - Implement proper error handling
   - Use strong cipher suites
   - Keep certificates and keys separate from application code

3. **Monitoring**
   - Monitor SSL connection failures
   - Track certificate expiration
   - Log SSL-related errors
   - Implement alerting for SSL issues

## Additional Resources

- [MySQL SSL Documentation](https://dev.mysql.com/doc/refman/8.0/en/using-encrypted-connections.html)
- [AWS RDS SSL Documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
- [OpenSSL Documentation](https://www.openssl.org/docs/) 