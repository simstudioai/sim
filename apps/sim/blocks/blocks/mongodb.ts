import { MongoDBIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MongoDBResponse } from '@/tools/mongodb/types'

export const MongoDBBlock: BlockConfig<MongoDBResponse> = {
  type: 'mongodb',
  name: 'MongoDB',
  description: 'Connect to MongoDB database',
  longDescription:
    'Connect to any MongoDB database to execute queries, manage data, and perform database operations. Supports find, insert, update, delete, and aggregation operations with secure connection handling.',
  docsLink: 'https://docs.sim.ai/tools/mongodb',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MongoDBIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Find Documents', id: 'query' },
        { label: 'Insert Documents', id: 'insert' },
        { label: 'Update Documents', id: 'update' },
        { label: 'Delete Documents', id: 'delete' },
        { label: 'Aggregate Pipeline', id: 'execute' },
      ],
      value: () => 'query',
    },
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      layout: 'full',
      placeholder: 'localhost or your.mongodb.host',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      layout: 'full',
      placeholder: '27017',
      value: () => '27017',
      required: true,
    },
    {
      id: 'database',
      title: 'Database Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'your_database',
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      layout: 'full',
      placeholder: 'mongodb_user',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      layout: 'full',
      password: true,
      placeholder: 'Your database password',
      required: true,
    },
    {
      id: 'authSource',
      title: 'Auth Source',
      type: 'short-input',
      layout: 'full',
      placeholder: 'admin',
    },
    {
      id: 'ssl',
      title: 'SSL Mode',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Disabled', id: 'disabled' },
        { label: 'Required', id: 'required' },
        { label: 'Preferred', id: 'preferred' },
      ],
      value: () => 'preferred',
    },
    {
      id: 'collection',
      title: 'Collection Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'users',
      required: true,
    },
    {
      id: 'query',
      title: 'Query Filter (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"status": "active"}',
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MongoDB developer. Generate MongoDB query filters as JSON objects based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the MongoDB query filter as valid JSON. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON object that can be used directly in a MongoDB find() operation.

### FILTER GUIDELINES
1. **Syntax**: Use MongoDB query operators and proper JSON syntax
2. **Performance**: Consider indexing and query optimization
3. **Security**: Use safe query patterns, avoid NoSQL injection risks
4. **Data Types**: Use appropriate MongoDB data types (ObjectId, Date, etc.)
5. **Efficiency**: Structure filters for optimal query execution

### MONGODB QUERY OPERATORS

**Comparison Operators**:
- **$eq**: Equals - \`{"status": {"$eq": "active"}}\` or \`{"status": "active"}\`
- **$ne**: Not equals - \`{"status": {"$ne": "inactive"}}\`
- **$gt**: Greater than - \`{"age": {"$gt": 18}}\`
- **$gte**: Greater than or equal - \`{"price": {"$gte": 100}}\`
- **$lt**: Less than - \`{"score": {"$lt": 90}}\`
- **$lte**: Less than or equal - \`{"rating": {"$lte": 5}}\`
- **$in**: In array - \`{"category": {"$in": ["tech", "science"]}}\`
- **$nin**: Not in array - \`{"status": {"$nin": ["deleted", "banned"]}}\`

**Logical Operators**:
- **$and**: AND condition - \`{"$and": [{"age": {"$gte": 18}}, {"status": "active"}]}\`
- **$or**: OR condition - \`{"$or": [{"status": "active"}, {"status": "pending"}]}\`
- **$not**: NOT condition - \`{"age": {"$not": {"$lt": 18}}}\`
- **$nor**: NOR condition - \`{"$nor": [{"status": "deleted"}, {"verified": false}]}\`

**Element Operators**:
- **$exists**: Field exists - \`{"email": {"$exists": true}}\`
- **$type**: Field type - \`{"count": {"$type": "number"}}\`

**Array Operators**:
- **$all**: All elements match - \`{"tags": {"$all": ["tech", "mongodb"]}}\`
- **$elemMatch**: Element matches - \`{"scores": {"$elemMatch": {"$gte": 80, "$lt": 90}}}\`
- **$size**: Array size - \`{"items": {"$size": 3}}\`

**String Operators**:
- **$regex**: Regular expression - \`{"name": {"$regex": "^John", "$options": "i"}}\`
- **$text**: Text search - \`{"$text": {"$search": "mongodb tutorial"}}\`

### EXAMPLES

**Simple equality**: "Find active users"
→ {"status": "active"}

**By ObjectId**: "Find document by ID"
→ {"_id": ObjectId("507f1f77bcf86cd799439011")}

**Range query**: "Find products between $10 and $100"
→ {"price": {"$gte": 10, "$lte": 100}}

**Multiple conditions**: "Find active premium users"
→ {"status": "active", "plan": "premium"}

**OR condition**: "Find active or pending orders"
→ {"$or": [{"status": "active"}, {"status": "pending"}]}

**Array contains**: "Find users with admin role"
→ {"roles": {"$in": ["admin"]}}

**Text search**: "Find posts containing 'mongodb'"
→ {"$text": {"$search": "mongodb"}}

**Date range**: "Find recent posts (last 30 days)"
→ {"createdAt": {"$gte": {"$date": "2024-01-01T00:00:00.000Z"}}}

**Nested object**: "Find users in New York"
→ {"address.city": "New York"}

**Field exists**: "Find users with email addresses"
→ {"email": {"$exists": true, "$ne": null}}

**Complex AND/OR**: "Find active users who are either premium or have high score"
→ {"$and": [{"status": "active"}, {"$or": [{"plan": "premium"}, {"score": {"$gte": 90}}]}]}

**Array matching**: "Find posts with specific tags"
→ {"tags": {"$all": ["javascript", "tutorial"]}}

**Regex pattern**: "Find users with Gmail addresses"
→ {"email": {"$regex": "@gmail\\.com$", "$options": "i"}}

**Size check**: "Find users with exactly 3 hobbies"
→ {"hobbies": {"$size": 3}}

**Null/undefined check**: "Find incomplete profiles"
→ {"$or": [{"profile": null}, {"profile": {"$exists": false}}]}

### SECURITY CONSIDERATIONS
- Avoid directly embedding user input without validation
- Use proper data types (ObjectId for IDs, dates for timestamps)
- Consider query performance and indexing
- Be cautious with regex patterns that could cause performance issues
- Validate that field names exist in your schema

### PERFORMANCE TIPS
- Structure filters to use indexed fields first
- Use specific equality matches when possible
- Avoid complex regex patterns on large collections
- Consider using compound indexes for multi-field queries
- Use $limit in combination with filters for large result sets

### REMEMBER
Return ONLY the MongoDB query filter as valid JSON - no explanations, no markdown, no extra text. The output must be ready to use directly in MongoDB operations.`,
        placeholder: 'Describe the documents you want to find...',
        generationType: 'mongodb-filter',
      },
    },
    {
      id: 'pipeline',
      title: 'Aggregation Pipeline (JSON Array)',
      type: 'code',
      layout: 'full',
      placeholder: '[{"$group": {"_id": "$status", "count": {"$sum": 1}}}]',
      condition: { field: 'operation', value: 'execute' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MongoDB aggregation developer. Create MongoDB aggregation pipelines based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the aggregation pipeline as a valid JSON array. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON array.

### PIPELINE GUIDELINES
1. **Structure**: Always return a JSON array of aggregation stages
2. **Performance**: Order stages efficiently - use $match and $limit early when possible
3. **Security**: Avoid unsafe operations or overly complex expressions
4. **Readability**: Use clear field names and logical stage ordering
5. **Data Types**: Handle ObjectId, dates, numbers, and nested objects correctly

### AGGREGATION STAGES
**Filtering & Matching:**
- $match: Filter documents (use early in pipeline)
- $lookup: Join collections
- $facet: Multi-faceted aggregations

**Grouping & Analysis:**
- $group: Group by fields and calculate aggregates
- $bucket: Group into predefined ranges
- $bucketAuto: Auto-generate buckets
- $count: Count documents

**Transformation:**
- $project: Select/transform fields
- $addFields: Add computed fields  
- $set: Set field values
- $unset: Remove fields
- $unwind: Deconstruct arrays

**Sorting & Limiting:**
- $sort: Sort documents
- $limit: Limit results
- $skip: Skip documents
- $sample: Random sample

**Advanced:**
- $graphLookup: Recursive lookups
- $redact: Conditionally reshape documents
- $replaceRoot: Replace document root

### EXAMPLES

**Basic Aggregation**: "Count users by status"
→ [
    {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    {"$sort": {"count": -1}}
  ]

**Multi-Stage Analysis**: "Get top 10 customers by total order value"
→ [
    {"$match": {"status": "completed"}},
    {"$group": {
      "_id": "$customerId", 
      "totalValue": {"$sum": "$amount"},
      "orderCount": {"$sum": 1}
    }},
    {"$sort": {"totalValue": -1}},
    {"$limit": 10},
    {"$project": {
      "customerId": "$_id",
      "totalValue": 1,
      "orderCount": 1,
      "averageOrderValue": {"$divide": ["$totalValue", "$orderCount"]},
      "_id": 0
    }}
  ]

**Complex Join**: "Get users with their recent orders and order totals"
→ [
    {"$lookup": {
      "from": "orders",
      "localField": "_id",
      "foreignField": "userId",
      "as": "orders"
    }},
    {"$unwind": {
      "path": "$orders",
      "preserveNullAndEmptyArrays": true
    }},
    {"$match": {
      "$or": [
        {"orders.createdAt": {"$gte": new Date(Date.now() - 30*24*60*60*1000)}},
        {"orders": {"$exists": false}}
      ]
    }},
    {"$group": {
      "_id": "$_id",
      "name": {"$first": "$name"},
      "email": {"$first": "$email"},
      "recentOrderCount": {"$sum": {"$cond": [{"$ifNull": ["$orders", false]}, 1, 0]}},
      "totalOrderValue": {"$sum": {"$ifNull": ["$orders.amount", 0]}}
    }},
    {"$sort": {"totalOrderValue": -1}}
  ]

**Date Analysis**: "Monthly sales trends with growth rates"
→ [
    {"$match": {
      "createdAt": {"$gte": new Date("2024-01-01")},
      "status": "completed"
    }},
    {"$group": {
      "_id": {
        "year": {"$year": "$createdAt"},
        "month": {"$month": "$createdAt"}
      },
      "totalSales": {"$sum": "$amount"},
      "orderCount": {"$sum": 1}
    }},
    {"$sort": {"_id.year": 1, "_id.month": 1}},
    {"$group": {
      "_id": null,
      "monthlyData": {"$push": {
        "period": "$_id",
        "totalSales": "$totalSales",
        "orderCount": "$orderCount"
      }}
    }},
    {"$unwind": {
      "path": "$monthlyData",
      "includeArrayIndex": "index"
    }},
    {"$project": {
      "period": "$monthlyData.period",
      "totalSales": "$monthlyData.totalSales", 
      "orderCount": "$monthlyData.orderCount",
      "previousSales": {"$arrayElemAt": ["$monthlyData.totalSales", {"$subtract": ["$index", 1]}]},
      "growthRate": {"$cond": [
        {"$and": [
          {"$gt": ["$index", 0]},
          {"$gt": [{"$arrayElemAt": ["$monthlyData.totalSales", {"$subtract": ["$index", 1]}]}, 0]}
        ]},
        {"$multiply": [
          {"$divide": [
            {"$subtract": ["$monthlyData.totalSales", {"$arrayElemAt": ["$monthlyData.totalSales", {"$subtract": ["$index", 1]}]}]},
            {"$arrayElemAt": ["$monthlyData.totalSales", {"$subtract": ["$index", 1]}]}
          ]},
          100
        ]},
        null
      ]}
    }}
  ]

**Text Search & Filtering**: "Search products with filters and scoring"
→ [
    {"$match": {
      "$text": {"$search": "laptop gaming"},
      "category": "electronics",
      "price": {"$gte": 500, "$lte": 2000}
    }},
    {"$addFields": {
      "searchScore": {"$meta": "textScore"},
      "priceScore": {"$divide": [{"$subtract": [2000, "$price"]}, 1500]}
    }},
    {"$project": {
      "name": 1,
      "price": 1,
      "category": 1,
      "rating": 1,
      "reviewCount": 1,
      "combinedScore": {"$add": [
        {"$multiply": ["$searchScore", 0.6]},
        {"$multiply": ["$priceScore", 0.2]},
        {"$multiply": ["$rating", 0.2]}
      ]}
    }},
    {"$sort": {"combinedScore": -1}},
    {"$limit": 20}
  ]

**Geo-spatial Analysis**: "Find nearby stores with inventory"
→ [
    {"$geoNear": {
      "near": {"type": "Point", "coordinates": [-74.005, 40.7128]},
      "distanceField": "distance",
      "maxDistance": 10000,
      "spherical": true
    }},
    {"$lookup": {
      "from": "inventory",
      "localField": "_id",
      "foreignField": "storeId", 
      "as": "inventory"
    }},
    {"$addFields": {
      "inventoryCount": {"$size": "$inventory"},
      "hasProduct": {"$in": ["target-product-id", "$inventory.productId"]}
    }},
    {"$match": {"hasProduct": true}},
    {"$project": {
      "name": 1,
      "address": 1,
      "distance": {"$round": ["$distance", 0]},
      "inventoryCount": 1
    }},
    {"$sort": {"distance": 1}},
    {"$limit": 5}
  ]

### PERFORMANCE TIPS
- Place $match as early as possible to reduce document flow
- Use $limit after $sort for top-N queries  
- Index fields used in $match, $sort, and $lookup operations
- Use $project to reduce document size in multi-stage pipelines
- Consider $facet for multiple aggregations on same data

### SECURITY CONSIDERATIONS
- Validate input parameters to prevent injection
- Use appropriate read concerns for consistency requirements
- Be cautious with $where and $expr in $match stages
- Limit pipeline complexity to prevent timeout/resource issues

### REMEMBER
Return ONLY the JSON array pipeline - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the aggregation you want to perform...',
        generationType: 'mongodb-pipeline',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      layout: 'full',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'sort',
      title: 'Sort (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"createdAt": -1}',
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Write MongoDB sort criteria as JSON.

### CONTEXT
{context}

### EXAMPLES
Newest first: {"createdAt": -1}
Alphabetical: {"name": 1}
Multiple fields: {"category": 1, "price": -1}

Use 1 for ascending, -1 for descending. Return ONLY valid JSON.`,
        placeholder: 'Describe how you want to sort the results...',
        generationType: 'mongodb-sort',
      },
    },
    {
      id: 'documents',
      title: 'Documents (JSON Array)',
      type: 'code',
      layout: 'full',
      placeholder: '[{"name": "John Doe", "email": "john@example.com", "status": "active"}]',
      condition: { field: 'operation', value: 'insert' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Write MongoDB documents as JSON array.

### CONTEXT
{context}

### EXAMPLES
Simple user: [{"name": "John Doe", "email": "john@example.com", "active": true}]
With nested data: [{"user": {"name": "Jane", "profile": {"age": 25, "city": "NYC"}}, "status": "active"}]
Multiple docs: [{"name": "User1", "type": "admin"}, {"name": "User2", "type": "user"}]

Return ONLY valid JSON array - no explanations.`,
        placeholder: 'Describe the documents you want to insert...',
        generationType: 'mongodb-documents',
      },
    },
    {
      id: 'filter',
      title: 'Filter (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"name": "Alice Test"}',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MongoDB developer. Generate MongoDB query filters as JSON objects to target specific documents for UPDATE operations.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the MongoDB query filter as valid JSON. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON object that will identify which documents to update.

### UPDATE FILTER GUIDELINES
1. **Precision**: Use specific criteria to target exact documents you want to update
2. **Safety**: Avoid broad filters that might update unintended documents
3. **Uniqueness**: When possible, use unique identifiers like _id or email
4. **Verification**: Consider what happens if multiple documents match your filter

### MONGODB QUERY OPERATORS

**Comparison Operators**:
- **$eq**: Equals - \`{"status": {"$eq": "active"}}\` or \`{"status": "active"}\`
- **$ne**: Not equals - \`{"status": {"$ne": "inactive"}}\`
- **$gt**: Greater than - \`{"age": {"$gt": 18}}\`
- **$gte**: Greater than or equal - \`{"price": {"$gte": 100}}\`
- **$lt**: Less than - \`{"score": {"$lt": 90}}\`
- **$lte**: Less than or equal - \`{"rating": {"$lte": 5}}\`
- **$in**: In array - \`{"category": {"$in": ["tech", "science"]}}\`
- **$nin**: Not in array - \`{"status": {"$nin": ["deleted", "banned"]}}\`

**Logical Operators**:
- **$and**: AND condition - \`{"$and": [{"age": {"$gte": 18}}, {"status": "active"}]}\`
- **$or**: OR condition - \`{"$or": [{"status": "active"}, {"status": "pending"}]}\`
- **$not**: NOT condition - \`{"age": {"$not": {"$lt": 18}}}\`

**Element Operators**:
- **$exists**: Field exists - \`{"email": {"$exists": true}}\`
- **$type**: Field type - \`{"count": {"$type": "number"}}\`

### UPDATE FILTER EXAMPLES

**By unique ID**: "Update specific document by ID"
→ {"_id": ObjectId("507f1f77bcf86cd799439011")}

**By unique email**: "Update user with specific email"
→ {"email": "john.doe@example.com"}

**By username**: "Update user account by username"
→ {"username": "johndoe"}

**Multiple specific criteria**: "Update active users in sales department"
→ {"status": "active", "department": "sales"}

**Conditional update**: "Update expired premium accounts"
→ {"plan": "premium", "expiryDate": {"$lt": {"$date": "2024-01-01T00:00:00.000Z"}}}

**Status-based update**: "Update all pending orders"
→ {"status": "pending"}

**Range-based update**: "Update products with low stock"
→ {"stock": {"$lt": 10}, "active": true}

**Complex condition**: "Update users who haven't logged in recently"
→ {"$and": [{"status": "active"}, {"lastLogin": {"$lt": {"$date": "2023-12-01T00:00:00.000Z"}}}]}

### SAFETY CONSIDERATIONS FOR UPDATES
- **Always test your filter first** with a find() operation to see what documents match
- **Use unique identifiers** when updating single documents (_id, email, username)
- **Be specific** - avoid filters that might match more documents than intended
- **Consider using $and** to combine multiple conditions for precision
- **Validate field names** exist in your schema before updating

### REMEMBER
Return ONLY the MongoDB query filter as valid JSON - no explanations, no markdown, no extra text. This filter will determine which documents get updated, so be precise and careful.`,
        placeholder: 'Describe which documents to update...',
        generationType: 'mongodb-filter',
      },
    },
    {
      id: 'update',
      title: 'Update (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"$set": {"name": "Jane Doe", "email": "jane@example.com"}}',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MongoDB developer. Generate ONLY the raw JSON update operation based on the user's request.
The output MUST be a single, valid JSON object representing MongoDB update operators.

### CONTEXT
{context}

### SAFETY CONSIDERATIONS
- ALWAYS use atomic operators ($set, $unset, $inc, etc.) - never provide raw field assignments
- For destructive operations like $unset or array modifications, ensure the request is intentional
- Consider data types when setting values (strings, numbers, booleans, dates, ObjectIds)
- Use $addToSet instead of $push to prevent duplicate array elements when appropriate
- Validate that increment operations use numeric values

### MONGODB UPDATE OPERATORS & EXAMPLES

#### Field Update Operators:
- $set (update/create fields): {"$set": {"name": "John Doe", "email": "john@example.com", "lastLogin": new Date()}}
- $unset (remove fields): {"$unset": {"temporaryField": "", "deprecatedData": ""}}
- $inc (increment numbers): {"$inc": {"views": 1, "score": -5, "balance": 100.50}}
- $mul (multiply values): {"$mul": {"price": 0.9, "quantity": 2}}
- $min (update if smaller): {"$min": {"lowestScore": 85}}
- $max (update if larger): {"$max": {"highestScore": 95}}
- $currentDate (set current date): {"$currentDate": {"lastModified": true, "timestamp": {"$type": "date"}}}
- $rename (rename fields): {"$rename": {"old_name": "new_name", "temp_field": "permanent_field"}}

#### Array Update Operators:
- $push (add element): {"$push": {"tags": "new-tag", "comments": {"user": "john", "text": "Great post!"}}}
- $push with $each (add multiple): {"$push": {"tags": {"$each": ["tag1", "tag2", "tag3"]}}}
- $push with $position: {"$push": {"items": {"$each": ["new-item"], "$position": 0}}}
- $push with $slice: {"$push": {"recent_activity": {"$each": [{"action": "login"}], "$slice": -10}}}
- $addToSet (add unique): {"$addToSet": {"tags": "unique-tag", "categories": {"$each": ["cat1", "cat2"]}}}
- $pull (remove matching): {"$pull": {"tags": "unwanted-tag", "items": {"status": "deleted"}}}
- $pullAll (remove multiple): {"$pullAll": {"tags": ["tag1", "tag2"], "numbers": [1, 3, 5]}}
- $pop (remove first/last): {"$pop": {"queue": -1, "stack": 1}}

#### Array Element Updates:
- Positional $ operator: {"$set": {"comments.$.approved": true, "items.$.quantity": 5}}
- Array filters $[]: {"$set": {"items.$[elem].status": "active"}}, arrayFilters: [{"elem.category": "electronics"}]
- Multiple positional $[]: {"$inc": {"items.$[item].reviews.$[review].helpful": 1}}

#### Complex Combinations:
- Multiple operations: {"$set": {"name": "Updated Name", "status": "active"}, "$inc": {"version": 1}, "$push": {"history": {"action": "updated", "date": new Date()}}}
- Nested field updates: {"$set": {"profile.settings.notifications": true, "profile.lastSeen": new Date()}}
- Conditional updates with $cond in aggregation: {"$set": {"discount": {"$cond": [{"$gte": ["$orderAmount", 100]}, 0.1, 0]}}}

#### Data Type Examples:
- String: {"$set": {"name": "John Doe", "status": "active"}}
- Number: {"$set": {"age": 25, "score": 87.5}, "$inc": {"points": 100}}
- Boolean: {"$set": {"isActive": true, "verified": false}}
- Date: {"$set": {"createdAt": new Date("2024-01-01"), "updatedAt": new Date()}}
- ObjectId: {"$set": {"userId": ObjectId("507f1f77bcf86cd799439011")}}
- Array: {"$set": {"tags": ["mongodb", "database", "nosql"]}}
- Object: {"$set": {"metadata": {"source": "api", "version": "1.2", "processed": true}}}

### IMPORTANT FORMATTING RULES:
1. Return ONLY valid JSON - no explanations, comments, or markdown formatting
2. Use proper MongoDB update operator syntax
3. Ensure all string values are properly quoted
4. Use appropriate data types (new Date() for dates, ObjectId() for IDs)
5. For array operations, consider whether $addToSet (unique) or $push (allows duplicates) is appropriate
6. When incrementing, ensure the value is numeric
7. Structure complex nested updates clearly
8. Always validate that field paths exist in your data model

### REFERENCE VARIABLES:
You have access to workflow context variables:
- Input parameters: Use <paramName> syntax (e.g., <userId>, <newStatus>)
- Environment variables: Use {{ENV_VAR}} syntax (e.g., {{DEFAULT_STATUS}})
- Previous block outputs: Use <block.previousBlock.output.field> syntax

Generate the MongoDB update operation that safely and accurately fulfills the user's request.`,
        placeholder: 'Describe what you want to update...',
        generationType: 'mongodb-update',
      },
    },
    {
      id: 'upsert',
      title: 'Upsert',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'multi',
      title: 'Update Multiple',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'filter',
      title: 'Filter (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"status": "inactive"}',
      condition: { field: 'operation', value: 'delete' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MongoDB developer. Generate MongoDB query filters as JSON objects to target specific documents for DELETION operations.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the MongoDB query filter as valid JSON. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON object that will identify which documents to delete.

### ⚠️ DELETION SAFETY WARNING ⚠️
DELETIONS ARE PERMANENT! This filter will determine which documents are permanently removed from the database. Be extremely careful and specific with your criteria.

### DELETE FILTER GUIDELINES
1. **EXTREME PRECISION**: Use the most specific criteria possible to target exact documents
2. **UNIQUE IDENTIFIERS**: Prefer using unique fields like _id, email, or username
3. **TEST FIRST**: Always test with find() before deleting to verify what matches
4. **BACKUP**: Consider backing up data before bulk deletions
5. **VALIDATION**: Double-check that your filter criteria are correct

### MONGODB QUERY OPERATORS

**Comparison Operators**:
- **$eq**: Equals - \`{"status": {"$eq": "inactive"}}\` or \`{"status": "inactive"}\`
- **$ne**: Not equals - \`{"status": {"$ne": "active"}}\`
- **$gt**: Greater than - \`{"age": {"$gt": 65}}\`
- **$gte**: Greater than or equal - \`{"createdAt": {"$gte": {"$date": "2024-01-01T00:00:00.000Z"}}}\`
- **$lt**: Less than - \`{"lastLogin": {"$lt": {"$date": "2023-01-01T00:00:00.000Z"}}}\`
- **$lte**: Less than or equal - \`{"score": {"$lte": 0}}\`
- **$in**: In array - \`{"status": {"$in": ["deleted", "banned", "inactive"]}}\`
- **$nin**: Not in array - \`{"type": {"$nin": ["admin", "moderator"]}}\`

**Logical Operators**:
- **$and**: AND condition - \`{"$and": [{"status": "inactive"}, {"lastLogin": {"$lt": {"$date": "2023-01-01T00:00:00.000Z"}}}]}\`
- **$or**: OR condition - \`{"$or": [{"status": "deleted"}, {"status": "banned"}]}\`
- **$not**: NOT condition - \`{"status": {"$not": {"$eq": "active"}}}\`

**Element Operators**:
- **$exists**: Field exists - \`{"deletedAt": {"$exists": true}}\`
- **$type**: Field type - \`{"tempData": {"$type": "null"}}\`

### DELETE FILTER EXAMPLES

**By unique ID**: "Delete specific document by ID"
→ {"_id": ObjectId("507f1f77bcf86cd799439011")}

**By unique email**: "Delete specific user account"
→ {"email": "user.to.delete@example.com"}

**By inactive status**: "Delete inactive user accounts"
→ {"status": "inactive"}

**By deletion flag**: "Delete documents marked for deletion"
→ {"markedForDeletion": true}

**Old temporary data**: "Delete temporary data older than 30 days"
→ {"type": "temp", "createdAt": {"$lt": {"$date": "2023-12-01T00:00:00.000Z"}}}

**Expired sessions**: "Delete expired user sessions"
→ {"type": "session", "expiresAt": {"$lt": {"$date": "2024-01-01T00:00:00.000Z"}}}

**Banned users**: "Delete banned user accounts"
→ {"status": "banned", "bannedAt": {"$exists": true}}

**Multiple criteria**: "Delete inactive accounts with no recent activity"
→ {"$and": [{"status": "inactive"}, {"lastLogin": {"$lt": {"$date": "2023-06-01T00:00:00.000Z"}}}, {"verified": false}]}

**By category**: "Delete draft posts older than 90 days"
→ {"status": "draft", "createdAt": {"$lt": {"$date": "2023-10-01T00:00:00.000Z"}}}

### EXTREME SAFETY CONSIDERATIONS FOR DELETIONS
- **⚠️ ALWAYS TEST YOUR FILTER FIRST** with db.collection.find(filter) to see exactly what will be deleted
- **Use the most specific criteria possible** - prefer unique identifiers
- **Consider soft deletion** (marking as deleted) instead of hard deletion
- **Backup important data** before performing bulk deletions
- **Avoid broad filters** that might delete more than intended
- **Validate field names** exist in your schema
- **Document your deletion criteria** for audit purposes
- **Consider the impact** on related data and foreign keys

### REMEMBER
Return ONLY the MongoDB query filter as valid JSON - no explanations, no markdown, no extra text. This filter will PERMANENTLY DELETE documents, so be extremely careful and precise!`,
        placeholder: 'Describe which documents to delete...',
        generationType: 'mongodb-filter',
      },
    },
    {
      id: 'multi',
      title: 'Delete Multiple',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'delete' },
    },
  ],
  tools: {
    access: [
      'mongodb_query',
      'mongodb_insert',
      'mongodb_update',
      'mongodb_delete',
      'mongodb_execute',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'mongodb_query'
          case 'insert':
            return 'mongodb_insert'
          case 'update':
            return 'mongodb_update'
          case 'delete':
            return 'mongodb_delete'
          case 'execute':
            return 'mongodb_execute'
          default:
            throw new Error(`Invalid MongoDB operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, documents, ...rest } = params

        let parsedDocuments
        if (documents && typeof documents === 'string' && documents.trim()) {
          try {
            parsedDocuments = JSON.parse(documents)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid JSON documents format: ${errorMsg}. Please check your JSON syntax.`
            )
          }
        } else if (documents && typeof documents === 'object') {
          parsedDocuments = documents
        }

        const connectionConfig = {
          host: rest.host,
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 27017,
          database: rest.database,
          username: rest.username,
          password: rest.password,
          authSource: rest.authSource,
          ssl: rest.ssl || 'preferred',
        }

        const result: any = { ...connectionConfig }

        if (rest.collection) result.collection = rest.collection
        if (rest.query) {
          result.query = typeof rest.query === 'string' ? rest.query : JSON.stringify(rest.query)
        }
        if (rest.limit && rest.limit !== '') {
          result.limit =
            typeof rest.limit === 'string' ? Number.parseInt(rest.limit, 10) : rest.limit
        } else {
          result.limit = 100 // Default to 100 if not provided
        }
        if (rest.sort) {
          result.sort = typeof rest.sort === 'string' ? rest.sort : JSON.stringify(rest.sort)
        }
        if (rest.filter) {
          result.filter =
            typeof rest.filter === 'string' ? rest.filter : JSON.stringify(rest.filter)
        }
        if (rest.update) {
          result.update =
            typeof rest.update === 'string' ? rest.update : JSON.stringify(rest.update)
        }
        if (rest.pipeline) {
          result.pipeline =
            typeof rest.pipeline === 'string' ? rest.pipeline : JSON.stringify(rest.pipeline)
        }
        if (rest.upsert) result.upsert = rest.upsert === 'true' || rest.upsert === true
        if (rest.multi) result.multi = rest.multi === 'true' || rest.multi === true
        if (parsedDocuments !== undefined) result.documents = parsedDocuments

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Database operation to perform' },
    host: { type: 'string', description: 'MongoDB host' },
    port: { type: 'string', description: 'MongoDB port' },
    database: { type: 'string', description: 'Database name' },
    username: { type: 'string', description: 'MongoDB username' },
    password: { type: 'string', description: 'MongoDB password' },
    authSource: { type: 'string', description: 'Authentication database' },
    ssl: { type: 'string', description: 'SSL mode' },
    collection: { type: 'string', description: 'Collection name' },
    query: { type: 'string', description: 'Query filter as JSON string' },
    limit: { type: 'number', description: 'Limit number of documents' },
    sort: { type: 'string', description: 'Sort criteria as JSON string' },
    documents: { type: 'json', description: 'Documents to insert' },
    filter: { type: 'string', description: 'Filter criteria as JSON string' },
    update: { type: 'string', description: 'Update operations as JSON string' },
    pipeline: { type: 'string', description: 'Aggregation pipeline as JSON string' },
    upsert: { type: 'boolean', description: 'Create document if not found' },
    multi: { type: 'boolean', description: 'Operate on multiple documents' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    documents: {
      type: 'array',
      description: 'Array of documents returned from the operation',
    },
    documentCount: {
      type: 'number',
      description: 'Number of documents affected by the operation',
    },
    insertedId: {
      type: 'string',
      description: 'ID of the inserted document (single insert)',
    },
    insertedIds: {
      type: 'array',
      description: 'Array of IDs for inserted documents (multiple insert)',
    },
    modifiedCount: {
      type: 'number',
      description: 'Number of documents modified (update operations)',
    },
    deletedCount: {
      type: 'number',
      description: 'Number of documents deleted (delete operations)',
    },
    matchedCount: {
      type: 'number',
      description: 'Number of documents matched (update operations)',
    },
  },
}
