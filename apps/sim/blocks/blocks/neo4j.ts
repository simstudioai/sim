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

**Match with WHERE**:
MATCH (n:Person) WHERE n.age > 21 RETURN n.name, n.age

**Match Relationship**:
MATCH (p:Person)-[:KNOWS]->(friend:Person) RETURN p.name, friend.name

**Match with Relationship Properties**:
MATCH (p:Person)-[r:RATED {rating: 5}]->(m:Movie) RETURN p.name, m.title

**Pattern with Multiple Nodes**:
MATCH (p:Person)-[:ACTED_IN]->(m:Movie)<-[:DIRECTED]-(d:Person) RETURN p.name, m.title, d.name

**Variable Length Paths**:
MATCH (p1:Person)-[:KNOWS*1..3]-(p2:Person) WHERE p1.name = "Alice" RETURN p2.name

**Shortest Path**:
MATCH path = shortestPath((p1:Person)-[:KNOWS*]-(p2:Person)) WHERE p1.name = "Alice" AND p2.name = "Bob" RETURN path

### EXAMPLES

**Find all nodes**: MATCH (n:Person) RETURN n LIMIT 10
**Find by property**: MATCH (n:Person) WHERE n.name = "Alice" RETURN n
**Find relationships**: MATCH (p:Person)-[r:KNOWS]->(f:Person) RETURN p.name, type(r), f.name
**Find with multiple labels**: MATCH (n:Person:Employee) RETURN n
**Aggregate data**: MATCH (p:Person) RETURN p.country, count(p) as personCount ORDER BY personCount DESC

Return ONLY the Cypher query - no explanations.`,
        placeholder: 'Describe what you want to query...',
        generationType: 'neo4j-query',
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

### CREATE PATTERNS

**Create Single Node**:
CREATE (n:Person {name: "Alice", age: 30, email: "alice@example.com"})

**Create Multiple Nodes**:
CREATE (n1:Person {name: "Alice"}), (n2:Person {name: "Bob"})

**Create Node with Relationship**:
CREATE (p:Person {name: "Alice"})-[:KNOWS {since: 2020}]->(f:Person {name: "Bob"})

**Create Relationship Between Existing Nodes**:
MATCH (a:Person {name: "Alice"}), (b:Person {name: "Bob"})
CREATE (a)-[:KNOWS {since: 2024}]->(b)

**Return Created Nodes**:
CREATE (n:Person {name: "Alice", age: 30}) RETURN n

### EXAMPLES
Create person: CREATE (n:Person {name: "Alice", age: 30})
Create with relationship: CREATE (p:Person {name: "Alice"})-[:WORKS_AT]->(c:Company {name: "Acme"})
Create multiple: CREATE (a:Person {name: "Alice"}), (b:Person {name: "Bob"}), (a)-[:KNOWS]->(b)

Return ONLY the Cypher CREATE statement.`,
        placeholder: 'Describe what you want to create...',
        generationType: 'neo4j-create',
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
        generationType: 'neo4j-merge',
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

**Replace All Properties**:
MATCH (n:Person {name: "Alice"}) SET n = {name: "Alice", age: 31, email: "alice@example.com"}

**Add Property**:
MATCH (n:Person {name: "Alice"}) SET n.verified = true

**Remove Property**:
MATCH (n:Person {name: "Alice"}) REMOVE n.temporaryField

**Add Label**:
MATCH (n:Person {name: "Alice"}) SET n:Employee

### EXAMPLES
Update age: MATCH (n:Person {name: "Alice"}) SET n.age = 31
Update multiple: MATCH (n:Person) WHERE n.city = "NYC" SET n.verified = true, n.updated = timestamp()

Return ONLY the Cypher update statement.`,
        placeholder: 'Describe what you want to update...',
        generationType: 'neo4j-update',
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
        generationType: 'neo4j-delete',
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

**Complex Relationships**:
MATCH (p:Person)-[:ACTED_IN]->(m:Movie)<-[:DIRECTED]-(d:Person) RETURN p.name, m.title, d.name

**Conditional Logic**:
MATCH (p:Person) RETURN p.name, CASE WHEN p.age < 18 THEN 'minor' ELSE 'adult' END as ageGroup

**Subqueries**:
MATCH (p:Person) WHERE EXISTS { MATCH (p)-[:KNOWS]->(:Person)-[:KNOWS]->(:Person) } RETURN p

**Path Patterns**:
MATCH path = (p1:Person)-[:KNOWS*1..3]-(p2:Person) WHERE p1.name = "Alice" RETURN path, length(path)

Return ONLY the Cypher query.`,
        placeholder: 'Describe your query...',
        generationType: 'neo4j-execute',
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
        prompt: `Generate JSON parameters for the Cypher query.

### CONTEXT
{context}

### INSTRUCTION
Return ONLY valid JSON object with parameter values. Use parameter syntax in queries like: MATCH (n:Person {name: $name}) WHERE n.age > $minAge

### EXAMPLES
{"name": "Alice", "age": 30}
{"minValue": 100, "status": "active"}
{"startDate": "2024-01-01", "endDate": "2024-12-31"}

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
      type: 'object',
      description: 'Execution summary with timing and database change counters',
    },
  },
}
