import { MySQLIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MySQLResponse } from '@/tools/mysql/types'

export const MySQLBlock: BlockConfig<MySQLResponse> = {
  type: 'mysql',
  name: 'MySQL',
  description: 'Connect to MySQL database',
  longDescription:
    'Integrate MySQL into the workflow. Can query, insert, update, delete, and execute raw SQL.',
  docsLink: 'https://docs.sim.ai/tools/mysql',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MySQLIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query (SELECT)', id: 'query' },
        { label: 'Insert Data', id: 'insert' },
        { label: 'Update Data', id: 'update' },
        { label: 'Delete Data', id: 'delete' },
        { label: 'Execute Raw SQL', id: 'execute' },
      ],
      value: () => 'query',
    },
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'localhost or your.database.host',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '3306',
      value: () => '3306',
      required: true,
    },
    {
      id: 'database',
      title: 'Database Name',
      type: 'short-input',
      placeholder: 'your_database',
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'root',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Your database password',
      required: true,
    },
    {
      id: 'ssl',
      title: 'SSL Mode',
      type: 'dropdown',
      options: [
        { label: 'Disabled', id: 'disabled' },
        { label: 'Required', id: 'required' },
        { label: 'Preferred', id: 'preferred' },
      ],
      value: () => 'preferred',
    },
    // Table field for insert/update/delete operations
    {
      id: 'table',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'users',
      condition: { field: 'operation', value: 'insert' },
      required: true,
    },
    {
      id: 'table',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'users',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'table',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'users',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // SQL Query field
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM users WHERE active = true',
      condition: { field: 'operation', value: 'query' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MySQL database developer. Write MySQL SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use MySQL-specific syntax and functions
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow MySQL naming conventions

### MYSQL FEATURES
- Use MySQL-specific functions (IFNULL, DATE_FORMAT, CONCAT, etc.)
- Leverage MySQL features like GROUP_CONCAT, AUTO_INCREMENT
- Use proper MySQL data types (VARCHAR, DATETIME, DECIMAL, JSON, etc.)
- Include appropriate LIMIT clauses for large result sets

### EXAMPLES

**Simple Select**: "Get all active users"
→ SELECT id, name, email, created_at 
  FROM users 
  WHERE active = 1 
  ORDER BY created_at DESC;

**Complex Join**: "Get users with their order counts and total spent"
→ SELECT 
      u.id,
      u.name,
      u.email,
      COUNT(o.id) as order_count,
      IFNULL(SUM(o.total), 0) as total_spent
  FROM users u
  LEFT JOIN orders o ON u.id = o.user_id
  WHERE u.active = 1
  GROUP BY u.id, u.name, u.email
  HAVING COUNT(o.id) > 0
  ORDER BY total_spent DESC;

**With Subquery**: "Get top 10 products by sales"
→ SELECT 
      p.id,
      p.name,
      (SELECT SUM(oi.quantity * oi.price)
       FROM order_items oi 
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.product_id = p.id 
       AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ) as total_sales
  FROM products p
  WHERE p.active = 1
  ORDER BY total_sales DESC
  LIMIT 10;

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the SQL query you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM table_name',
      condition: { field: 'operation', value: 'execute' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MySQL database developer. Write MySQL SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use MySQL-specific syntax and functions
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow MySQL naming conventions

### MYSQL FEATURES
- Use MySQL-specific functions (IFNULL, DATE_FORMAT, CONCAT, etc.)
- Leverage MySQL features like GROUP_CONCAT, AUTO_INCREMENT
- Use proper MySQL data types (VARCHAR, DATETIME, DECIMAL, JSON, etc.)
- Include appropriate LIMIT clauses for large result sets

### EXAMPLES

**Simple Select**: "Get all active users"
→ SELECT id, name, email, created_at 
  FROM users 
  WHERE active = 1 
  ORDER BY created_at DESC;

**Complex Join**: "Get users with their order counts and total spent"
→ SELECT 
      u.id,
      u.name,
      u.email,
      COUNT(o.id) as order_count,
      IFNULL(SUM(o.total), 0) as total_spent
  FROM users u
  LEFT JOIN orders o ON u.id = o.user_id
  WHERE u.active = 1
  GROUP BY u.id, u.name, u.email
  HAVING COUNT(o.id) > 0
  ORDER BY total_spent DESC;

**With Subquery**: "Get top 10 products by sales"
→ SELECT 
      p.id,
      p.name,
      (SELECT SUM(oi.quantity * oi.price)
       FROM order_items oi 
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.product_id = p.id 
       AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ) as total_sales
  FROM products p
  WHERE p.active = 1
  ORDER BY total_sales DESC
  LIMIT 10;

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the SQL query you need...',
        generationType: 'sql-query',
      },
    },
    // Data for insert operations
    {
      id: 'data',
      title: 'Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "John Doe",\n  "email": "john@example.com",\n  "active": true\n}',
      condition: { field: 'operation', value: 'insert' },
      required: true,
    },
    // Set clause for updates
    {
      id: 'data',
      title: 'Update Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "Jane Doe",\n  "email": "jane@example.com"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    // Where clause for update/delete
    {
      id: 'where',
      title: 'WHERE Condition',
      type: 'short-input',
      placeholder: 'id = 1',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'where',
      title: 'WHERE Condition',
      type: 'short-input',
      placeholder: 'id = 1',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
  ],
  tools: {
    access: ['mysql_query', 'mysql_insert', 'mysql_update', 'mysql_delete', 'mysql_execute'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'mysql_query'
          case 'insert':
            return 'mysql_insert'
          case 'update':
            return 'mysql_update'
          case 'delete':
            return 'mysql_delete'
          case 'execute':
            return 'mysql_execute'
          default:
            throw new Error(`Invalid MySQL operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, data, ...rest } = params

        // Parse JSON data if it's a string
        let parsedData
        if (data && typeof data === 'string' && data.trim()) {
          try {
            parsedData = JSON.parse(data)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(`Invalid JSON data format: ${errorMsg}. Please check your JSON syntax.`)
          }
        } else if (data && typeof data === 'object') {
          parsedData = data
        }

        // Build connection config
        const connectionConfig = {
          host: rest.host,
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 3306,
          database: rest.database,
          username: rest.username,
          password: rest.password,
          ssl: rest.ssl || 'preferred',
        }

        // Build params object
        const result: any = { ...connectionConfig }

        if (rest.table) result.table = rest.table
        if (rest.query) result.query = rest.query
        if (rest.where) result.where = rest.where
        if (parsedData !== undefined) result.data = parsedData

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Database operation to perform' },
    host: { type: 'string', description: 'Database host' },
    port: { type: 'string', description: 'Database port' },
    database: { type: 'string', description: 'Database name' },
    username: { type: 'string', description: 'Database username' },
    password: { type: 'string', description: 'Database password' },
    ssl: { type: 'string', description: 'SSL mode' },
    table: { type: 'string', description: 'Table name' },
    query: { type: 'string', description: 'SQL query to execute' },
    data: { type: 'json', description: 'Data for insert/update operations' },
    where: { type: 'string', description: 'WHERE clause for update/delete' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    rows: {
      type: 'array',
      description: 'Array of rows returned from the query',
    },
    rowCount: {
      type: 'number',
      description: 'Number of rows affected by the operation',
    },
  },
}
