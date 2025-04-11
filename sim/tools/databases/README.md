# Database Tools for Sim Studio

This directory contains tools for interacting with various databases in Sim Studio.

## Available Tools

### MySQL Tool
- Supports basic CRUD operations (SELECT, INSERT, UPDATE, DELETE)
- Supports stored procedure execution
- Connection pooling and SSL support
- Parameter binding for safe query execution

### PostgreSQL Tool
- Supports basic CRUD operations (SELECT, INSERT, UPDATE, DELETE)
- Supports function execution
- Connection pooling and SSL support
- Parameter binding for safe query execution

## Usage Example

```typescript
// MySQL example
const mysqlResult = await executeTool('mysql', {
  operation: 'SELECT',
  query: 'SELECT * FROM users WHERE id = ?',
  parameters: [1],
  config: {
    host: 'localhost',      // or your RDS endpoint
    port: 3306,            // default MySQL port
    username: 'your_user',
    password: 'your_pass',
    database: 'your_db',
    useSSL: true           // recommended for production
  }
});

// PostgreSQL example
const postgresResult = await executeTool('postgresql', {
  operation: 'SELECT',
  query: 'SELECT * FROM users WHERE id = $1',
  parameters: [1],
  config: {
    host: 'localhost',      // or your RDS endpoint
    port: 5432,            // default PostgreSQL port
    username: 'your_user',
    password: 'your_pass',
    database: 'your_db',
    useSSL: true           // recommended for production
  }
});
```

## AWS RDS Setup

To use these tools with AWS RDS:

1. Create an RDS instance in your AWS account
2. Configure security groups to allow access from your application
3. Use the RDS endpoint as the host in your configuration
4. Enable SSL if required by your security policy

### Example RDS Configuration

```typescript
const rdsConfig = {
  host: 'your-instance.xxxxx.region.rds.amazonaws.com',
  port: 3306,            // or 5432 for PostgreSQL
  username: 'your_user',
  password: 'your_pass',
  database: 'your_db',
  useSSL: true
};

// Use the configuration with any database operation
const result = await executeTool('mysql', {
  operation: 'SELECT',
  query: 'SELECT * FROM users',
  config: rdsConfig
});
```

## Environment Variables

For security, it's recommended to use environment variables for sensitive configuration:

```env
DB_HOST=your-instance.xxxxx.region.rds.amazonaws.com
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_pass
DB_NAME=your_db
DB_SSL=true
```

Then in your code:

```typescript
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  useSSL: process.env.DB_SSL === 'true'
};
```

## Security Considerations

1. Never commit database credentials to version control
2. Use environment variables for sensitive configuration
3. Implement proper access control in your application
4. Use SSL for production environments
5. Follow the principle of least privilege for database users
6. Regularly rotate database credentials
7. Monitor and audit database access

## Error Handling

The tools provide detailed error messages for common issues:
- Connection failures
- Authentication errors
- Query syntax errors
- Permission errors
- Timeout errors

## Development

To add support for a new database:

1. Create a new directory under `tools/databases/`
2. Implement the tool following the ToolConfig interface
3. Add API route handler in `app/api/database/[provider]`
4. Update documentation
5. Add tests 