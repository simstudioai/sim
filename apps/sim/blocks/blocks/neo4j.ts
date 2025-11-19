import { Neo4jIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { Neo4jResponse } from '@/tools/neo4j/types'

export const Neo4jBlock: BlockConfig<Neo4jResponse> = {
  type: 'neo4j',
  name: 'Neo4j',
  description: 'Connect to Neo4j graph database',
  longDescription:
    'Integrate Neo4j graph database into the workflow. Can query, create, merge, update, and delete nodes and relationships.',
  docsLink: 'https://docs.sim.ai/tools/neo4j',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: Neo4jIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query (MATCH)', id: 'query' },
        { label: 'Create Nodes/Relationships', id: 'create' },
        { label: 'Merge (Find or Create)', id: 'merge' },
        { label: 'Update Properties (SET)', id: 'update' },
        { label: 'Delete Nodes/Relationships', id: 'delete' },
        { label: 'Execute Cypher', id: 'execute' },
      ],
      value: () => 'query',
    },
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'localhost or your.neo4j.host',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '7687',
      value: () => '7687',
      required: true,
    },
    {
      id: 'database',
      title: 'Database Name',
      type: 'short-input',
      placeholder: 'neo4j',
      value: () => 'neo4j',
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'neo4j',
      value: () => 'neo4j',
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
      id: 'encryption',
      title: 'Encryption',
      type: 'dropdown',
      options: [
        { label: 'Disabled', id: 'disabled' },
        { label: 'Enabled (TLS/SSL)', id: 'enabled' },
      ],
      value: () => 'disabled',
    },
    {
      id: 'cypherQuery',
      title: 'Cypher Query',
      type: 'code',
      placeholder: 'MATCH (n:Person) WHERE n.age > 21 RETURN n LIMIT 10',
      required: true,
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Neo4j and Cypher developer. Generate Cypher queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the Cypher query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw Cypher query.

### QUERY GUIDELINES
1. **Pattern Matching**: Use MATCH to find patterns in the graph
2. **Filtering**: Use WHERE clauses for conditions
3. **Return**: Specify what to return with RETURN
4. **Performance**: Use indexes when possible
5. **Limit Results**: Add LIMIT for large result sets

### CYPHER QUERY PATTERNS

**Basic Node Match**:
MATCH (n:Person) RETURN n LIMIT 25

**Match with Properties**:
MATCH (n:Person {name: "Alice"}) RETURN n

**Match with Parameters (Recommended)**:
MATCH (n:Person {name: $name}) RETURN n

**Match with WHERE and Parameters**:
MATCH (n:Person) WHERE n.age > $minAge RETURN n.name, n.age

**Match Relationship**:
MATCH (p:Person)-[:KNOWS]->(friend:Person) RETURN p.name, friend.name

**Match with Relationship Properties**:
MATCH (p:Person)-[r:RATED {rating: 5}]->(m:Movie) RETURN p.name, m.title

**Pattern with Multiple Nodes**:
MATCH (p:Person)-[:ACTED_IN]->(m:Movie)<-[:DIRECTED]-(d:Person) RETURN p.name, m.title, d.name

**Variable Length Paths**:
MATCH (p1:Person)-[:KNOWS*1..3]-(p2:Person) WHERE p1.name = $name RETURN p2.name

**Shortest Path**:
MATCH path = shortestPath((p1:Person)-[:KNOWS*]-(p2:Person)) WHERE p1.name = $name1 AND p2.name = $name2 RETURN path

**Complex WHERE with Parameters**:
MATCH (p:Person) WHERE p.age > $minAge AND p.age < $maxAge AND p.country = $country RETURN p

### EXAMPLES

**Find all nodes**: MATCH (n:Person) RETURN n LIMIT 10
**Find by property**: MATCH (n:Person) WHERE n.name = "Alice" RETURN n
**Find with parameters**: MATCH (n:Person) WHERE n.name = $name AND n.age > $minAge RETURN n
**Find relationships**: MATCH (p:Person)-[r:KNOWS]->(f:Person) RETURN p.name, type(r), f.name
**Find with multiple labels**: MATCH (n:Person:Employee) RETURN n
**Aggregate data**: MATCH (p:Person) RETURN p.country, count(p) as personCount ORDER BY personCount DESC
**Range query with params**: MATCH (p:Product) WHERE p.price >= $minPrice AND p.price <= $maxPrice RETURN p

### NOTE
Use the Parameters field for dynamic values to improve security and query performance.

Return ONLY the Cypher query - no explanations.`,
        placeholder: 'Describe what you want to query...',
        generationType: 'neo4j-cypher',
      },
    },
    {
      id: 'cypherQuery',
      title: 'Cypher CREATE Statement',
      type: 'code',
      placeholder: 'CREATE (n:Person {name: "Alice", age: 30})',
      required: true,
      condition: { field: 'operation', value: 'create' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Neo4j developer. Generate Cypher CREATE statements to add new nodes and relationships.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the Cypher CREATE statement. No explanations, no markdown, just the raw Cypher query.

### ⚠️ DUPLICATE WARNING
CREATE always creates new nodes/relationships, even if identical ones exist.
- Use MERGE operation if you want to avoid duplicates (find-or-create behavior)
- Use CREATE only when you want to guarantee new entities

### CREATE PATTERNS

**Create Single Node**:
CREATE (n:Person {name: "Alice", age: 30, email: "alice@example.com"})

**Create with Parameters (Recommended)**:
CREATE (n:Person {name: $name, age: $age, email: $email}) RETURN n

**Create Multiple Nodes**:
CREATE (n1:Person {name: "Alice"}), (n2:Person {name: "Bob"})

**Create Node with Relationship**:
CREATE (p:Person {name: "Alice"})-[:KNOWS {since: 2020}]->(f:Person {name: "Bob"})

**Create Relationship Between Existing Nodes**:
MATCH (a:Person {name: "Alice"}), (b:Person {name: "Bob"})
CREATE (a)-[:KNOWS {since: 2024}]->(b)

**Create with Parameters and Return**:
CREATE (n:Person {name: $name, age: $age}) RETURN n

**Batch Create with Parameters**:
UNWIND $users AS user
CREATE (n:Person {name: user.name, email: user.email})

### EXAMPLES
Create person: CREATE (n:Person {name: "Alice", age: 30})
Create with params: CREATE (n:Person {name: $name, age: $age}) RETURN n
Create with relationship: CREATE (p:Person {name: "Alice"})-[:WORKS_AT]->(c:Company {name: "Acme"})
Create multiple: CREATE (a:Person {name: "Alice"}), (b:Person {name: "Bob"}), (a)-[:KNOWS]->(b)
Batch create: UNWIND $items AS item CREATE (n:Product {name: item.name, price: item.price})

### NOTE
Use the Parameters field with CREATE for dynamic values and security.

Return ONLY the Cypher CREATE statement.`,
        placeholder: 'Describe what you want to create...',
        generationType: 'neo4j-cypher',
      },
    },
    {
      id: 'cypherQuery',
      title: 'Cypher MERGE Statement',
      type: 'code',
      placeholder:
        'MERGE (n:Person {email: "alice@example.com"}) ON CREATE SET n.created = timestamp() RETURN n',
      required: true,
      condition: { field: 'operation', value: 'merge' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Neo4j developer. Generate Cypher MERGE statements for find-or-create operations.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the Cypher MERGE statement. No explanations, no markdown, just the raw Cypher query.

### MERGE PATTERNS

**Basic Merge**:
MERGE (n:Person {email: "alice@example.com"})

**Merge with ON CREATE**:
MERGE (n:Person {email: "alice@example.com"})
ON CREATE SET n.created = timestamp(), n.name = "Alice"

**Merge with ON MATCH**:
MERGE (n:Person {email: "alice@example.com"})
ON MATCH SET n.lastSeen = timestamp()

**Merge with Both**:
MERGE (n:Person {email: "alice@example.com"})
ON CREATE SET n.created = timestamp(), n.name = "Alice"
ON MATCH SET n.lastSeen = timestamp()

**Merge Relationship**:
MATCH (p:Person {name: "Alice"}), (c:Company {name: "Acme"})
MERGE (p)-[:WORKS_AT {since: 2024}]->(c)

### EXAMPLES
Merge person: MERGE (n:Person {email: "alice@example.com"}) ON CREATE SET n.created = timestamp()
Merge relationship: MERGE (p:Person {name: "Alice"})-[:KNOWS]->(f:Person {name: "Bob"})

Return ONLY the Cypher MERGE statement.`,
        placeholder: 'Describe what you want to merge...',
        generationType: 'neo4j-cypher',
      },
    },
    {
      id: 'cypherQuery',
      title: 'Cypher UPDATE Statement',
      type: 'code',
      placeholder: 'MATCH (n:Person {name: "Alice"}) SET n.age = 31, n.updated = timestamp()',
      required: true,
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Neo4j developer. Generate Cypher UPDATE statements using MATCH and SET.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the Cypher statement with MATCH and SET. No explanations, no markdown, just the raw Cypher query.

### UPDATE PATTERNS

**Update Single Property**:
MATCH (n:Person {name: "Alice"}) SET n.age = 31

**Update Multiple Properties**:
MATCH (n:Person {name: "Alice"}) SET n.age = 31, n.city = "NYC", n.updated = timestamp()

**Update with WHERE**:
MATCH (n:Person) WHERE n.age > 30 SET n.category = "senior"

**Update with Parameters**:
MATCH (n:Person {name: $name}) SET n.age = $age, n.city = $city

**Merge Properties (Safe)**:
MATCH (n:Person {name: "Alice"}) SET n += {age: 31, email: "alice@example.com"}

**⚠️ DANGEROUS - Replace All Properties (removes unlisted properties)**:
MATCH (n:Person {name: "Alice"}) SET n = {name: "Alice", age: 31}
Note: This removes ALL properties not specified. Use SET n += {...} instead to merge properties safely.

**Add Property**:
MATCH (n:Person {name: "Alice"}) SET n.verified = true

**Remove Property**:
MATCH (n:Person {name: "Alice"}) REMOVE n.temporaryField

**Add Label**:
MATCH (n:Person {name: "Alice"}) SET n:Employee

**Increment Counter**:
MATCH (n:Person {name: "Alice"}) SET n.loginCount = n.loginCount + 1

### EXAMPLES
Update age: MATCH (n:Person {name: "Alice"}) SET n.age = 31
Update multiple: MATCH (n:Person) WHERE n.city = "NYC" SET n.verified = true, n.updated = timestamp()
With parameters: MATCH (n:Person) WHERE n.email = $email SET n.lastLogin = timestamp()
Merge properties safely: MATCH (n:Person {id: $userId}) SET n += {status: "active", verified: true}

### SAFETY NOTE
Use SET n += {...} to merge properties safely. Avoid SET n = {...} unless you explicitly want to replace ALL properties.

Return ONLY the Cypher update statement.`,
        placeholder: 'Describe what you want to update...',
        generationType: 'neo4j-cypher',
      },
    },
    {
      id: 'cypherQuery',
      title: 'Cypher DELETE Statement',
      type: 'code',
      placeholder: 'MATCH (n:Person {name: "Alice"}) DETACH DELETE n',
      required: true,
      condition: { field: 'operation', value: 'delete' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Neo4j developer. Generate Cypher DELETE statements to remove nodes and relationships.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the Cypher DELETE statement. No explanations, no markdown, just the raw Cypher query.

### ⚠️ DELETION WARNING ⚠️
DELETIONS ARE PERMANENT! Be extremely careful and specific with your criteria.

### DELETE PATTERNS

**Delete Node (must have no relationships)**:
MATCH (n:Person {name: "Alice"}) DELETE n

**DETACH DELETE (removes relationships first)**:
MATCH (n:Person {name: "Alice"}) DETACH DELETE n

**Delete Relationship Only**:
MATCH (p:Person {name: "Alice"})-[r:KNOWS]->(f:Person) DELETE r

**Delete with WHERE**:
MATCH (n:Person) WHERE n.status = "inactive" DETACH DELETE n

**Delete Multiple Nodes**:
MATCH (n:TempNode) WHERE n.created < timestamp() - 86400000 DETACH DELETE n

### SAFETY
- Always use DETACH DELETE for nodes with relationships
- Use specific WHERE clauses to target exact nodes
- Test with MATCH first to see what will be deleted
- Prefer unique identifiers when deleting

### EXAMPLES
Delete person: MATCH (n:Person {email: "alice@example.com"}) DETACH DELETE n
Delete relationship: MATCH (p:Person)-[r:KNOWS]->(f:Person) WHERE p.name = "Alice" DELETE r
Delete old data: MATCH (n:TempData) WHERE n.created < timestamp() - 2592000000 DETACH DELETE n

Return ONLY the Cypher DELETE statement.`,
        placeholder: 'Describe what you want to delete...',
        generationType: 'neo4j-cypher',
      },
    },
    {
      id: 'cypherQuery',
      title: 'Cypher Query',
      type: 'code',
      placeholder: 'MATCH (n:Person) RETURN n LIMIT 10',
      required: true,
      condition: { field: 'operation', value: 'execute' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Neo4j developer. Generate any Cypher query based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the Cypher query. No explanations, no markdown, just the raw Cypher query.

### ADVANCED PATTERNS

**Aggregation**:
MATCH (p:Person) RETURN p.country, count(p) as total ORDER BY total DESC

**Aggregation with COLLECT**:
MATCH (p:Person)-[:WORKS_AT]->(c:Company) RETURN c.name, collect(p.name) as employees

**Complex Relationships**:
MATCH (p:Person)-[:ACTED_IN]->(m:Movie)<-[:DIRECTED]-(d:Person) RETURN p.name, m.title, d.name

**WITH Clause for Chaining**:
MATCH (p:Person) WITH p ORDER BY p.age DESC LIMIT 10 MATCH (p)-[:KNOWS]->(friend) RETURN p.name, collect(friend.name) as friends

**Conditional Logic (CASE)**:
MATCH (p:Person) RETURN p.name, CASE WHEN p.age < 18 THEN 'minor' WHEN p.age < 65 THEN 'adult' ELSE 'senior' END as ageGroup

**Subqueries with EXISTS**:
MATCH (p:Person) WHERE EXISTS { MATCH (p)-[:KNOWS]->(:Person)-[:KNOWS]->(:Person) } RETURN p

**Subqueries with CALL**:
MATCH (p:Person) CALL { WITH p MATCH (p)-[:KNOWS]->(friend) RETURN count(friend) as friendCount } RETURN p.name, friendCount

**UNION (Combine Results)**:
MATCH (p:Person) WHERE p.age > 30 RETURN p.name, p.age UNION MATCH (p:Person) WHERE p.country = "USA" RETURN p.name, p.age

**FOREACH for Batch Updates**:
MATCH (p:Person) WHERE p.status = 'pending' FOREACH (x IN CASE WHEN p.age > 18 THEN [1] ELSE [] END | SET p.verified = true)

**Path Patterns**:
MATCH path = (p1:Person)-[:KNOWS*1..3]-(p2:Person) WHERE p1.name = "Alice" RETURN path, length(path)

**Transaction Batching** (5.x+):
CALL { MATCH (p:Person) WHERE p.status = 'inactive' DETACH DELETE p } IN TRANSACTIONS OF 100 ROWS

**Optional Match**:
MATCH (p:Person) OPTIONAL MATCH (p)-[:MANAGES]->(e:Person) RETURN p.name, collect(e.name) as employees

**Map Projections**:
MATCH (p:Person) RETURN p { .name, .age, friendCount: size((p)-[:KNOWS]->()) }

**Parameters in Advanced Query**:
MATCH (p:Person) WHERE p.age > $minAge WITH p ORDER BY p.age DESC LIMIT $limit MATCH (p)-[:KNOWS]->(friend) RETURN p.name, collect(friend.name) as friends

**Pattern Comprehension**:
MATCH (p:Person) RETURN p.name, [(p)-[:KNOWS]->(friend) WHERE friend.age > 25 | friend.name] as adultFriends

Return ONLY the Cypher query.`,
        placeholder: 'Describe your query...',
        generationType: 'neo4j-cypher',
      },
    },
    {
      id: 'parameters',
      title: 'Parameters (JSON)',
      type: 'code',
      placeholder: '{"name": "Alice", "minAge": 21}',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate JSON parameters for Cypher queries. Parameters are essential for security, performance, and reusability.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY a valid JSON object with parameter values. No explanations, no markdown, just the raw JSON object.

### WHY USE PARAMETERS?

**Security Benefits:**
- Prevents Cypher injection attacks
- Safely handles user input
- Separates data from query logic
- No need to escape special characters

**Performance Benefits:**
- Neo4j caches query execution plans
- Same query structure with different parameters reuses cached plan
- Significantly faster for repeated queries

**Code Quality:**
- Cleaner, more readable queries
- Easier to test and maintain
- Reusable query templates

### PARAMETER SYNTAX IN QUERIES

In Cypher queries, parameters are prefixed with $ and referenced by name:

MATCH (n:Person {name: $name}) WHERE n.age > $minAge RETURN n
MATCH (p)-[r:KNOWS {since: $year}]->(f) RETURN p, f
CREATE (n:Person {name: $name, email: $email, age: $age})
MERGE (n:User {id: $userId}) ON CREATE SET n.created = $timestamp

### DATA TYPES

**Strings**:
{"name": "Alice", "email": "alice@example.com", "status": "active"}

**Numbers** (integers and floats):
{"age": 30, "score": 95.5, "count": 1000, "rating": 4.8}

**Booleans**:
{"isActive": true, "verified": false, "premium": true}

**Arrays**:
{"tags": ["neo4j", "database", "graph"], "statuses": ["active", "pending"], "scores": [85, 90, 95]}

**Null**:
{"middleName": null, "company": null}

**Mixed Types**:
{"name": "Alice", "age": 30, "active": true, "tags": ["user", "premium"], "balance": 150.50}

### QUERY + PARAMETERS EXAMPLES

**Example 1: Simple Property Match**
Query: MATCH (n:Person {email: $email}) RETURN n
Parameters: {"email": "alice@example.com"}

**Example 2: Range Filter**
Query: MATCH (n:Person) WHERE n.age >= $minAge AND n.age <= $maxAge RETURN n
Parameters: {"minAge": 21, "maxAge": 65}

**Example 3: Array Membership**
Query: MATCH (n:Person) WHERE n.status IN $statuses RETURN n
Parameters: {"statuses": ["active", "pending", "verified"]}

**Example 4: Create with Parameters**
Query: CREATE (n:Person {name: $name, email: $email, age: $age, created: $timestamp})
Parameters: {"name": "Bob", "email": "bob@example.com", "age": 28, "timestamp": 1704067200000}

**Example 5: Update with Parameters**
Query: MATCH (n:Person {id: $userId}) SET n.lastLogin = $loginTime, n.loginCount = n.loginCount + 1
Parameters: {"userId": "user123", "loginTime": 1704067200000}

**Example 6: Relationship with Parameters**
Query: MATCH (a:Person {id: $fromId}), (b:Person {id: $toId}) CREATE (a)-[:KNOWS {since: $year}]->(b)
Parameters: {"fromId": "user1", "toId": "user2", "year": 2024}

### LIMITATIONS

**Cannot be Parameterized:**
- Label names: Cannot use $labelName
- Relationship types: Cannot use $relType
- Property keys: Cannot use $propertyKey
- Keywords: Cannot parameterize MATCH, CREATE, etc.

**Can be Parameterized:**
- Property values ✓
- Numeric constants ✓
- String literals ✓
- Arrays and lists ✓
- WHERE clause conditions ✓

### BEST PRACTICES

1. **Always use parameters for user input** - Never concatenate user data into queries
2. **Use descriptive names** - $userId instead of $id, $minAge instead of $min
3. **Type appropriately** - Use numbers for numeric values, not strings
4. **Validate before passing** - Ensure data types match expected values
5. **Reuse parameter names** - Same parameters work across similar queries for plan caching

Return ONLY valid JSON.`,
        placeholder: 'Describe the parameter values...',
        generationType: 'neo4j-parameters',
      },
    },
    {
      id: 'limit',
      title: 'Limit Results',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
    },
  ],
  tools: {
    access: [
      'neo4j_query',
      'neo4j_create',
      'neo4j_merge',
      'neo4j_update',
      'neo4j_delete',
      'neo4j_execute',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'neo4j_query'
          case 'create':
            return 'neo4j_create'
          case 'merge':
            return 'neo4j_merge'
          case 'update':
            return 'neo4j_update'
          case 'delete':
            return 'neo4j_delete'
          case 'execute':
            return 'neo4j_execute'
          default:
            throw new Error(`Invalid Neo4j operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, ...rest } = params

        let parsedParameters
        if (rest.parameters && typeof rest.parameters === 'string' && rest.parameters.trim()) {
          try {
            parsedParameters = JSON.parse(rest.parameters)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid JSON parameters format: ${errorMsg}. Please check your JSON syntax.`
            )
          }
        } else if (rest.parameters && typeof rest.parameters === 'object') {
          parsedParameters = rest.parameters
        }

        const connectionConfig = {
          host: rest.host,
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 7687,
          database: rest.database || 'neo4j',
          username: rest.username || 'neo4j',
          password: rest.password,
          encryption: rest.encryption || 'disabled',
        }

        const result: any = { ...connectionConfig }

        if (rest.cypherQuery) {
          result.cypherQuery = rest.cypherQuery
        }

        if (parsedParameters !== undefined) {
          result.parameters = parsedParameters
        }

        if (rest.limit && rest.limit !== '') {
          result.limit =
            typeof rest.limit === 'string' ? Number.parseInt(rest.limit, 10) : rest.limit
        }

        if (rest.detach !== undefined) {
          result.detach = rest.detach === 'true' || rest.detach === true
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Database operation to perform' },
    host: { type: 'string', description: 'Neo4j host' },
    port: { type: 'string', description: 'Neo4j port (Bolt protocol)' },
    database: { type: 'string', description: 'Database name' },
    username: { type: 'string', description: 'Neo4j username' },
    password: { type: 'string', description: 'Neo4j password' },
    encryption: { type: 'string', description: 'Connection encryption mode' },
    cypherQuery: { type: 'string', description: 'Cypher query to execute' },
    parameters: { type: 'json', description: 'Query parameters as JSON object' },
    limit: { type: 'number', description: 'Limit number of records' },
    detach: { type: 'boolean', description: 'Use DETACH DELETE for delete operations' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    records: {
      type: 'array',
      description: 'Array of records returned from the query',
    },
    recordCount: {
      type: 'number',
      description: 'Number of records returned or affected',
    },
    summary: {
      type: 'json',
      description: 'Execution summary with timing and database change counters',
    },
  },
}
